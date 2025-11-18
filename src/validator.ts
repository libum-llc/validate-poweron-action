import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as path from 'path';
import { SymitarHTTPs, SymitarSSH } from '@libum-llc/symitar';

export interface ValidationConfig {
  symitarHostname: string;
  symNumber: string;
  symitarUserNumber: string;
  symitarUserPassword: string;
  apiKey?: string;
  connectionType: 'https' | 'ssh';
  poweronDirectory: string;
  targetBranch?: string;
  ignoreList: string[];
  logPrefix: string;
}

export interface ValidationResult {
  filesValidated: number;
  filesPassed: number;
  filesFailed: number;
  errors: string[];
}

interface ChangedFile {
  filePath: string;
  status: string;
}

async function getChangedFiles(
  targetBranch: string | undefined,
  poweronDirectory: string,
  ignoreList: string[],
): Promise<ChangedFile[]> {
  if (!targetBranch) {
    // If no target branch, validate all files in directory
    let output = '';
    await exec.exec('find', [poweronDirectory, '-type', 'f', '-name', '*.PO'], {
      listeners: {
        stdout: (data: Buffer) => {
          output += data.toString();
        },
      },
    });

    return output
      .split('\n')
      .filter((f) => f.trim().length > 0)
      .filter((f) => !ignoreList.includes(path.basename(f)))
      .map((f) => ({ filePath: f, status: 'existing' }));
  }

  // Get changed files via git diff
  let output = '';
  await exec.exec('git', ['diff', '--name-status', targetBranch, '--', poweronDirectory], {
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

      // Skip deleted files and ignored files
      if (status !== 'D' && !ignoreList.includes(basename)) {
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
  const baseUrl = `https://${config.symitarHostname}`;
  const symitarConfig = {
    symNumber: parseInt(config.symNumber, 10),
    symitarUserNumber: config.symitarUserNumber,
    symitarUserPassword: config.symitarUserPassword,
  };

  const client = new SymitarHTTPs(baseUrl, symitarConfig);

  const errors: string[] = [];
  let filesFailed = 0;

  for (const file of files) {
    core.info(`${config.logPrefix} Validating ${file.filePath}...`);
    try {
      const result = await client.validatePowerOn(file.filePath);
      if (!result.isValid) {
        filesFailed++;
        const errorMsg = Array.isArray(result.errors) ? result.errors.join('\n') : result.errors;
        errors.push(`${path.basename(file.filePath)}: ${errorMsg}`);
      }
    } catch (error) {
      filesFailed++;
      const errorMsg = error instanceof Error ? error.message : String(error);
      errors.push(`${path.basename(file.filePath)}: ${errorMsg}`);
    }
  }

  client.end();

  return {
    filesValidated: files.length,
    filesPassed: files.length - filesFailed,
    filesFailed,
    errors,
  };
}

async function validateWithSSH(
  config: ValidationConfig,
  files: ChangedFile[],
): Promise<ValidationResult> {
  const sshConfig = {
    host: config.symitarHostname,
    username: config.symitarUserNumber,
    password: config.symitarUserPassword,
  };

  const client = new SymitarSSH(sshConfig);
  await client.isReady;

  const symitarConfig = {
    symNumber: parseInt(config.symNumber, 10),
    symitarUserNumber: config.symitarUserNumber,
    symitarUserPassword: config.symitarUserPassword,
  };

  const worker = await client.createValidateWorker(symitarConfig);

  const errors: string[] = [];
  let filesFailed = 0;

  for (const file of files) {
    core.info(`${config.logPrefix} Validating ${file.filePath}...`);
    try {
      const result = await worker.validatePowerOn(file.filePath);
      if (!result.isValid) {
        filesFailed++;
        const errorMsg = Array.isArray(result.errors) ? result.errors.join('\n') : result.errors;
        errors.push(`${path.basename(file.filePath)}: ${errorMsg}`);
      }
    } catch (error) {
      filesFailed++;
      const errorMsg = error instanceof Error ? error.message : String(error);
      errors.push(`${path.basename(file.filePath)}: ${errorMsg}`);
    }
  }

  await client.end();

  return {
    filesValidated: files.length,
    filesPassed: files.length - filesFailed,
    filesFailed,
    errors,
  };
}

export async function validatePowerOns(config: ValidationConfig): Promise<ValidationResult> {
  // Get changed files
  const files = await getChangedFiles(
    config.targetBranch,
    config.poweronDirectory,
    config.ignoreList,
  );

  if (files.length === 0) {
    core.info(`${config.logPrefix} No PowerOn files found to validate`);
    return {
      filesValidated: 0,
      filesPassed: 0,
      filesFailed: 0,
      errors: [],
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
