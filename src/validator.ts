import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as path from 'path';
import {
  SymitarHTTPs,
  SymitarSSH,
  SymitarSyncTransport,
  getSkipReasonForFile,
} from '@libum-llc/symitar';
import { validateApiKey } from './subscription';

export interface ValidationConfig {
  symitarHostname: string;
  symNumber: string;
  symitarUserNumber: string;
  symitarUserPassword: string;
  sshUsername: string;
  sshPassword: string;
  sshPort: number;
  apiKey: string;
  symitarAppPort?: number;
  connectionType: 'https' | 'ssh';
  poweronDirectory: string;
  targetBranch?: string;
  ignoreList: string[];
  preserveServerFiles?: string[];
  logPrefix: string;
  debug?: boolean;
  syncMethod?: 'rsync' | 'sftp';
}

export interface ValidationResult {
  filesValidated: number;
  filesPassed: number;
  filesFailed: number;
  errors: string[];
  validatedFiles: string[];
}

interface ChangedFile {
  filePath: string;
  status: string;
}

function getLocalPowerOnDirectory(config: ValidationConfig): string {
  return path.join(process.env.GITHUB_WORKSPACE || '', config.poweronDirectory);
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function patternToRegExp(pattern: string): RegExp {
  const source = pattern
    .split('*')
    .map((part) => part.split('?').map(escapeRegExp).join('.'))
    .join('.*');

  return new RegExp(`^${source}$`, 'i');
}

function matchesAnyPattern(fileName: string, patterns: string[] = []): boolean {
  return patterns.some((pattern) => patternToRegExp(pattern).test(fileName));
}

async function getChangedFilesFromGit(
  targetBranch: string,
  poweronDirectory: string,
  ignoreList: string[],
  preserveServerFiles: string[],
  logPrefix: string,
): Promise<ChangedFile[]> {
  // Ensure we're running in the workspace directory
  const workspace = process.env.GITHUB_WORKSPACE;
  const execOptions = workspace ? { cwd: workspace } : {};

  // Verify the target branch exists - try multiple formats
  const branchName = targetBranch.replace(/^origin\//, '');
  const branchVariants = [
    targetBranch,
    `refs/remotes/origin/${branchName}`,
    branchName,
    `refs/heads/${branchName}`,
    `remotes/origin/${branchName}`,
  ];

  let resolvedBranch = '';
  for (const variant of branchVariants) {
    const branchCheckExitCode = await exec.exec('git', ['rev-parse', '--verify', variant], {
      ...execOptions,
      ignoreReturnCode: true,
      silent: true,
    });

    if (branchCheckExitCode === 0) {
      resolvedBranch = variant;
      break;
    }
  }

  if (!resolvedBranch) {
    throw new Error(
      `Target branch '${targetBranch}' not found. Make sure you have checked out with sufficient depth (fetch-depth: 0) and the branch exists.`,
    );
  }

  // Use the resolved branch for git diff
  const actualTargetBranch = resolvedBranch;

  // Get changed files via git diff
  let output = '';
  await exec.exec('git', ['diff', '--name-status', actualTargetBranch, '--', poweronDirectory], {
    ...execOptions,
    silent: true,
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString();
      },
    },
  });

  const changedFiles: ChangedFile[] = [];
  const lines = output.split('\n').filter((line) => line.trim().length > 0);

  for (const line of lines) {
    const parts = line.split('\t');
    if (parts.length >= 2) {
      const status = parts[0];
      const filePath = parts[1];
      const basename = path.basename(filePath);

      // Skip deleted files
      if (status === 'D') {
        core.info(`${logPrefix} Skipping ${basename}. File was deleted.`);
        continue;
      }

      // Skip ignored files
      if (ignoreList.includes(basename)) {
        core.info(`${logPrefix} Skipping ${basename}. File is in ignore list.`);
        continue;
      }

      if (matchesAnyPattern(basename, preserveServerFiles)) {
        core.info(`${logPrefix} Skipping ${basename}. File is preserved from server.`);
        continue;
      }

      // Check if this file should be validated (handles extension + content checks)
      const fullPath = path.isAbsolute(filePath)
        ? filePath
        : path.join(process.env.GITHUB_WORKSPACE || '', filePath);

      const skipReason = await getSkipReasonForFile(fullPath);
      if (skipReason) {
        core.info(`${logPrefix} Skipping ${basename}: ${skipReason}`);
      } else {
        changedFiles.push({
          filePath,
          status: status === 'A' ? 'added' : status === 'M' ? 'modified' : status,
        });
      }
    }
  }

  return changedFiles;
}

async function validateWithHTTPs(
  config: ValidationConfig,
  files: ChangedFile[] | null,
): Promise<ValidationResult> {
  const baseUrl = config.symitarAppPort
    ? `https://${config.symitarHostname}:${config.symitarAppPort}`
    : `https://${config.symitarHostname}`;
  const symitarConfig = {
    symNumber: parseInt(config.symNumber, 10),
    symitarUserNumber: config.symitarUserNumber,
    symitarUserPassword: config.symitarUserPassword,
  };

  const sshConfig = {
    port: config.sshPort,
    username: config.sshUsername,
    password: config.sshPassword,
  };

  const logLevel = config.debug ? 'debug' : 'info';
  const client = new SymitarHTTPs(baseUrl, symitarConfig, logLevel, sshConfig);

  try {
    // If no files provided, get changed files by comparing local directory with host
    let filesToValidate: ChangedFile[];
    if (files === null) {
      core.info(
        `${config.logPrefix} Comparing local files with Sym ${config.symNumber} on ${config.symitarHostname}...`,
      );
      const localDirectory = getLocalPowerOnDirectory(config);
      const transport =
        config.syncMethod === 'rsync' ? SymitarSyncTransport.RSYNC : SymitarSyncTransport.SFTP;
      const changedPowerOns = await client.getChangedFiles(localDirectory, undefined, undefined, {
        transport,
      });

      filesToValidate = [];
      for (const filePath of changedPowerOns.deployed) {
        const basename = path.basename(filePath);

        // Check ignore list
        if (config.ignoreList.includes(basename)) {
          core.info(`${config.logPrefix} Skipping ${basename}. File is in ignore list.`);
          continue;
        }

        if (matchesAnyPattern(basename, config.preserveServerFiles)) {
          core.info(`${config.logPrefix} Skipping ${basename}. File is preserved from server.`);
          continue;
        }

        const fullPath = path.isAbsolute(filePath) ? filePath : path.join(localDirectory, filePath);

        const skipReason = await getSkipReasonForFile(fullPath);
        if (skipReason) {
          core.info(`${config.logPrefix} Skipping ${basename}. ${skipReason}`);
        } else {
          filesToValidate.push({ filePath: fullPath, status: 'changed' });
        }
      }

      if (filesToValidate.length === 0) {
        core.info(`${config.logPrefix} No PowerOn files found to validate`);
        return {
          filesValidated: 0,
          filesPassed: 0,
          filesFailed: 0,
          errors: [],
          validatedFiles: [],
        };
      }

      core.info(`${config.logPrefix} Found ${filesToValidate.length} file(s) to validate:`);
      for (const file of filesToValidate) {
        core.info(`${config.logPrefix} - ${path.basename(file.filePath)} (${file.status})`);
      }
    } else {
      filesToValidate = files;
    }

    const errors: string[] = [];
    const validatedFiles: string[] = [];
    let filesFailed = 0;

    for (const file of filesToValidate) {
      const fileName = path.basename(file.filePath);
      validatedFiles.push(fileName);
      core.info(`${config.logPrefix} Validating ${fileName}...`);
      try {
        const result = await client.validatePowerOn(file.filePath, {
          localIncludeDir: getLocalPowerOnDirectory(config),
        });
        if (!result.isValid) {
          filesFailed++;
          const errorMsg = Array.isArray(result.errors) ? result.errors.join('\n') : result.errors;
          errors.push(`${fileName}: ${errorMsg}`);
        }
      } catch (error) {
        filesFailed++;
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push(`${fileName}: ${errorMsg}`);
      }
    }

    return {
      filesValidated: filesToValidate.length,
      filesPassed: filesToValidate.length - filesFailed,
      filesFailed,
      errors,
      validatedFiles,
    };
  } finally {
    await client.end(); // Guarantee cleanup
  }
}

async function validateWithSSH(
  config: ValidationConfig,
  files: ChangedFile[] | null,
): Promise<ValidationResult> {
  const sshConfig = {
    host: config.symitarHostname,
    port: config.sshPort,
    username: config.sshUsername,
    password: config.sshPassword,
  };

  const logLevel = config.debug ? 'debug' : 'warn';
  const client = new SymitarSSH(sshConfig, logLevel);
  await client.isReady;

  try {
    const symitarConfig = {
      symNumber: parseInt(config.symNumber, 10),
      symitarUserNumber: config.symitarUserNumber,
      symitarUserPassword: config.symitarUserPassword,
    };

    // If no files provided, get changed files by comparing local directory with host
    let filesToValidate: ChangedFile[];
    if (files === null) {
      core.info(
        `${config.logPrefix} Comparing local files with Sym ${config.symNumber} on ${config.symitarHostname}...`,
      );
      const localDirectory = getLocalPowerOnDirectory(config);
      const transport =
        config.syncMethod === 'rsync' ? SymitarSyncTransport.RSYNC : SymitarSyncTransport.SFTP;
      const changedPowerOns = await client.getChangedFiles(
        symitarConfig,
        localDirectory,
        undefined,
        undefined,
        { transport },
      );

      filesToValidate = [];
      for (const filePath of changedPowerOns.deployed) {
        const basename = path.basename(filePath);

        // Check ignore list
        if (config.ignoreList.includes(basename)) {
          core.info(`${config.logPrefix} Skipping ${basename}. File is in ignore list.`);
          continue;
        }

        if (matchesAnyPattern(basename, config.preserveServerFiles)) {
          core.info(`${config.logPrefix} Skipping ${basename}. File is preserved from server.`);
          continue;
        }

        const fullPath = path.isAbsolute(filePath) ? filePath : path.join(localDirectory, filePath);

        const skipReason = await getSkipReasonForFile(fullPath);
        if (skipReason) {
          core.info(`${config.logPrefix} Skipping ${basename}. ${skipReason}`);
        } else {
          filesToValidate.push({ filePath: fullPath, status: 'changed' });
        }
      }

      if (filesToValidate.length === 0) {
        core.info(`${config.logPrefix} No PowerOn files found to validate`);
        return {
          filesValidated: 0,
          filesPassed: 0,
          filesFailed: 0,
          errors: [],
          validatedFiles: [],
        };
      }

      core.info(`${config.logPrefix} Found ${filesToValidate.length} file(s) to validate:`);
      for (const file of filesToValidate) {
        core.info(`${config.logPrefix} - ${path.basename(file.filePath)} (${file.status})`);
      }
    } else {
      filesToValidate = files;
    }

    const worker = await client.createValidateWorker(symitarConfig);

    const errors: string[] = [];
    const validatedFiles: string[] = [];
    let filesFailed = 0;

    // Process files sequentially - worker maintains state and resets after each validation
    for (const file of filesToValidate) {
      const fileName = path.basename(file.filePath);
      validatedFiles.push(fileName);
      core.info(`${config.logPrefix} Validating ${fileName}...`);

      try {
        const result = await worker.validatePowerOn(file.filePath, {
          localIncludeDir: getLocalPowerOnDirectory(config),
        });
        if (!result.isValid) {
          filesFailed++;
          const errorMsg = Array.isArray(result.errors) ? result.errors.join('\n') : result.errors;
          errors.push(`${fileName}: ${errorMsg}`);
        }
        core.info(`${config.logPrefix} ✓ ${fileName} validated`);
      } catch (error) {
        filesFailed++;
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push(`${fileName}: ${errorMsg}`);
        core.info(`${config.logPrefix} ✗ ${fileName} failed`);
      }
    }

    return {
      filesValidated: filesToValidate.length,
      filesPassed: filesToValidate.length - filesFailed,
      filesFailed,
      errors,
      validatedFiles,
    };
  } finally {
    await client.end(); // Guarantee cleanup
  }
}

export async function validatePowerOns(config: ValidationConfig): Promise<ValidationResult> {
  // Validate API key
  await validateApiKey(config.apiKey, config.symitarHostname);

  // If target branch is provided, get changed files via git diff
  // Otherwise, pass null to let the client compare against the host
  if (config.targetBranch) {
    const files = await getChangedFilesFromGit(
      config.targetBranch,
      config.poweronDirectory,
      config.ignoreList,
      config.preserveServerFiles || [],
      config.logPrefix,
    );

    if (files.length === 0) {
      core.info(`${config.logPrefix} No PowerOn files found to validate`);
      return {
        filesValidated: 0,
        filesPassed: 0,
        filesFailed: 0,
        errors: [],
        validatedFiles: [],
      };
    }

    core.info(`${config.logPrefix} Found ${files.length} file(s) to validate:`);
    for (const file of files) {
      core.info(`${config.logPrefix} - ${path.basename(file.filePath)} (${file.status})`);
    }

    // Validate based on connection type
    if (config.connectionType === 'https') {
      return validateWithHTTPs(config, files);
    } else {
      return validateWithSSH(config, files);
    }
  }

  // No target branch - client will compare local directory with host
  if (config.connectionType === 'https') {
    return validateWithHTTPs(config, null);
  } else {
    return validateWithSSH(config, null);
  }
}
