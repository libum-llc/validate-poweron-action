import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as path from 'path';
import {
  SymitarHTTPs,
  SymitarSSH,
  isPowerOnFile,
  getSkipReasonForFile,
  POWERON_EXTENSIONS,
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
  logPrefix: string;
  debug?: boolean;
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

async function getChangedFiles(
  targetBranch: string | undefined,
  poweronDirectory: string,
  ignoreList: string[],
  logPrefix: string,
): Promise<ChangedFile[]> {
  // Ensure we're running in the workspace directory
  const workspace = process.env.GITHUB_WORKSPACE;
  const execOptions = workspace ? { cwd: workspace } : {};

  if (!targetBranch) {
    // If no target branch, validate all PowerOn files in directory
    // Build find command with all PowerOn extensions
    const findArgs = [poweronDirectory, '-type', 'f', '('];
    POWERON_EXTENSIONS.forEach((ext, index) => {
      if (index > 0) findArgs.push('-o');
      findArgs.push('-iname', `*${ext}`);
    });
    findArgs.push(')');

    let output = '';
    await exec.exec('find', findArgs, {
      ...execOptions,
      silent: true,
      listeners: {
        stdout: (data: Buffer) => {
          output += data.toString();
        },
      },
    });

    const allFiles = output.split('\n').filter((f) => f.trim().length > 0);

    // Filter to only files that should be validated
    const filesToValidate: ChangedFile[] = [];
    for (const filePath of allFiles) {
      const basename = path.basename(filePath);

      // Check ignore list
      if (ignoreList.includes(basename)) {
        core.info(`${logPrefix} Skipping ${basename}. File is in ignore list.`);
        continue;
      }

      const fullPath = path.isAbsolute(filePath)
        ? filePath
        : path.join(process.env.GITHUB_WORKSPACE || '', filePath);

      const skipReason = await getSkipReasonForFile(fullPath);
      if (skipReason) {
        core.info(`${logPrefix} Skipping ${basename}. ${skipReason}`);
      } else {
        filesToValidate.push({ filePath, status: 'existing' });
      }
    }

    return filesToValidate;
  }

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

      // Skip non-PowerOn files
      if (!isPowerOnFile(filePath)) {
        core.info(`${logPrefix} Skipping ${basename}. Not detected to be a PowerOn file.`);
        continue;
      }

      // Check if this PowerOn file should be validated
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
  files: ChangedFile[],
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
    const errors: string[] = [];
    const validatedFiles: string[] = [];
    let filesFailed = 0;

    for (const file of files) {
      const fileName = path.basename(file.filePath);
      validatedFiles.push(fileName);
      core.info(`${config.logPrefix} Validating ${file.filePath}...`);
      try {
        const result = await client.validatePowerOn(file.filePath);
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
      filesValidated: files.length,
      filesPassed: files.length - filesFailed,
      filesFailed,
      errors,
      validatedFiles,
    };
  } finally {
    client.end(); // Guarantee cleanup
  }
}

async function validateWithSSH(
  config: ValidationConfig,
  files: ChangedFile[],
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

    const worker = await client.createValidateWorker(symitarConfig);

    const errors: string[] = [];
    const validatedFiles: string[] = [];
    let filesFailed = 0;

    // Process files sequentially - worker maintains state and resets after each validation
    for (const file of files) {
      const fileName = path.basename(file.filePath);
      validatedFiles.push(fileName);
      core.info(`${config.logPrefix} Validating ${file.filePath}...`);

      try {
        const result = await worker.validatePowerOn(file.filePath);
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
      filesValidated: files.length,
      filesPassed: files.length - filesFailed,
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
  core.info(`${config.logPrefix} Validating API key...`);
  await validateApiKey(config.apiKey, config.symitarHostname);
  core.info(`${config.logPrefix} API key validation successful`);

  // Get changed files
  const files = await getChangedFiles(
    config.targetBranch,
    config.poweronDirectory,
    config.ignoreList,
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
    core.info(`${config.logPrefix} - ${file.filePath} (${file.status})`);
  }

  // Validate based on connection type
  if (config.connectionType === 'https') {
    return validateWithHTTPs(config, files);
  } else {
    return validateWithSSH(config, files);
  }
}
