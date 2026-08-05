import * as path from 'path';

import type { SymitarHTTPs, SymitarSSH } from '@libum-llc/symitar';

import * as task from '@lib/task-shim';
import { getChangedFilesInDir } from '@lib/utils';
import {
  createHTTPsClient,
  createSSHClient,
  loadValidateConfig,
  validateTaskApiKey,
} from '@lib/task-orchestration';
import { createLogger } from '@lib/logger';
import { filterChangedFilesWithReport } from '@lib/validation-utils';

import type { ValidatePowerOnTaskDependencies } from './run';

/**
 * Returns the absolute local PowerOn directory for this workspace
 * @param powerOnsDirectory The repo-relative PowerOn directory
 */
export const resolveLocalPowerOnDirectory = (
  powerOnsDirectory: string,
): string =>
  path.join(
    process.env.GITHUB_WORKSPACE || '',
    powerOnsDirectory.replace(/\\/g, '/').replace(/\/+$/, ''),
  );

/**
 * Resolves a path reported by the Symitar client to its absolute local path.
 *
 * The vendored `mapDeployedToChangedFiles` assumes the client always returns
 * bare file names and unconditionally builds `${directory}${name}`. That
 * assumption holds on Azure DevOps but not on GitHub Actions, where changed
 * files come back carrying the PowerOn directory prefix - concatenating again
 * produced `REPWRITERSPECS/REPWRITERSPECS/FILE.PO`, which then failed the
 * `getSkipReasonForFile` stat and silently dropped the file from validation.
 *
 * Paths that already carry the PowerOn directory prefix are resolved against
 * `GITHUB_WORKSPACE`; bare names are resolved against the local PowerOn
 * directory. Absolute paths are returned untouched.
 *
 * @param powerOnsDirectory The repo-relative PowerOn directory
 * @param filePath The path reported by the Symitar client or by git
 */
export function resolveLocalPowerOnPath(
  powerOnsDirectory: string,
  filePath: string,
): string {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }

  const normalizedFilePath = filePath.replace(/\\/g, '/');
  const normalizedPowerOnDirectory = powerOnsDirectory
    .replace(/\\/g, '/')
    .replace(/\/+$/, '');

  if (
    normalizedFilePath === normalizedPowerOnDirectory ||
    normalizedFilePath.startsWith(`${normalizedPowerOnDirectory}/`)
  ) {
    return path.join(process.env.GITHUB_WORKSPACE || '', normalizedFilePath);
  }

  return path.join(
    resolveLocalPowerOnDirectory(powerOnsDirectory),
    normalizedFilePath,
  );
}

/**
 * Reduces a path reported by the Symitar client to the name the vendored
 * `mapDeployedToChangedFiles` expects: the file's location relative to the
 * PowerOn directory, with no directory prefix of its own.
 *
 * @param powerOnsDirectory The repo-relative PowerOn directory
 * @param deployedPath The path reported by the Symitar client
 */
export function toDeployedFileName(
  powerOnsDirectory: string,
  deployedPath: string,
): string {
  const localDirectory = resolveLocalPowerOnDirectory(powerOnsDirectory);
  const relative = path.relative(
    localDirectory,
    resolveLocalPowerOnPath(powerOnsDirectory, deployedPath),
  );

  if (!relative || relative.startsWith('..')) {
    return path.basename(deployedPath);
  }

  return relative.split(path.sep).join('/');
}

/**
 * Wraps an HTTPS client so reported changed files always come back as bare,
 * directory-relative names
 */
function withNormalizedHttpsChangedFiles(
  client: SymitarHTTPs,
  powerOnsDirectory: string,
): SymitarHTTPs {
  const getChangedFiles = client.getChangedFiles.bind(client);

  client.getChangedFiles = async (
    ...args: Parameters<SymitarHTTPs['getChangedFiles']>
  ) => {
    const changedFiles = await getChangedFiles(...args);

    return {
      ...changedFiles,
      deployed: changedFiles.deployed.map((deployedPath) =>
        toDeployedFileName(powerOnsDirectory, deployedPath),
      ),
    };
  };

  return client;
}

/**
 * Wraps an SSH client so reported changed files always come back as bare,
 * directory-relative names
 */
function withNormalizedSshChangedFiles(
  client: SymitarSSH,
  powerOnsDirectory: string,
): SymitarSSH {
  const getChangedFiles = client.getChangedFiles.bind(client);

  client.getChangedFiles = async (
    ...args: Parameters<SymitarSSH['getChangedFiles']>
  ) => {
    const changedFiles = await getChangedFiles(...args);

    return {
      ...changedFiles,
      deployed: changedFiles.deployed.map((deployedPath) =>
        toDeployedFileName(powerOnsDirectory, deployedPath),
      ),
    };
  };

  return client;
}

/**
 * Production dependencies for the vendored ValidatePowerOn runner.
 *
 * `runValidatePowerOnTask` is copied byte-identically from the Azure DevOps
 * extension, so every GitHub-specific behaviour has to arrive through this
 * object:
 *
 * - `task` is the `@actions/core` shim standing in for the pipelines task lib
 * - the client factories normalize reported changed-file paths so the vendored
 *   `mapDeployedToChangedFiles` cannot double-prefix them
 * - `filterChangedFiles` anchors the `getSkipReasonForFile` stat at
 *   `GITHUB_WORKSPACE` instead of the process working directory
 */
export const validatePowerOnDependencies: ValidatePowerOnTaskDependencies = {
  task,
  loadConfig: loadValidateConfig,
  validateApiKey: validateTaskApiKey,
  createHttpsClient: (config, sshClient) =>
    withNormalizedHttpsChangedFiles(
      createHTTPsClient(config, sshClient),
      config.powerOnsDirectory,
    ),
  createSshClient: async (config) =>
    withNormalizedSshChangedFiles(
      await createSSHClient(config),
      config.powerOnsDirectory,
    ),
  getGitChangedFiles: getChangedFilesInDir,
  createTaskLogger: createLogger,
  filterChangedFiles: (files, ignoreList, preserveServerFiles, baseDirectory) =>
    filterChangedFilesWithReport(
      files,
      ignoreList,
      preserveServerFiles,
      baseDirectory ?? process.env.GITHUB_WORKSPACE ?? undefined,
    ),
  registerCleanup: (event, listener) => process.on(event, listener),
};
