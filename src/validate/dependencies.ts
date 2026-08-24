import * as path from 'path';

import type { SymitarHTTPs, SymitarSSH } from '@libum-llc/symitar';

import {
  createLogger,
  filterChangedFilesWithReport,
  validateApiKey,
  type ValidatePowerOnTaskDependencies,
} from '@libum-llc/pipelines-core';

import { createGitHubTaskHost } from '../lib/github-task-host';
import { getChangedFilesInDir } from '../lib/utils';
import {
  createHTTPsClient,
  createSSHClient,
  loadValidateConfig,
} from '../lib/task-orchestration';

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
 * Core's `mapDeployedToChangedFiles` assumes the client always returns
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
 * Reduces a path reported by the Symitar client to the name core's
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

type ValidateWorker = Awaited<ReturnType<SymitarSSH['createValidateWorker']>>;
type ValidateOptions = Parameters<SymitarHTTPs['validatePowerOn']>[1];
type WorkerValidateOptions = Parameters<ValidateWorker['validatePowerOn']>[1];

/**
 * Returns a delegating view of `target` with the given methods replaced.
 *
 * The overrides are layered on with a `Proxy` rather than assigned onto the
 * instance: the caller's client is never mutated, so wrapping an already
 * wrapped or shared client cannot corrupt it. Non-overridden members are read
 * from - and bound to - the original instance, keeping private state intact.
 *
 * @param target The object to delegate to
 * @param overrides The members to serve instead of the target's own
 */
function withOverrides<T extends object>(target: T, overrides: Partial<T>): T {
  return new Proxy(target, {
    get(instance, property) {
      if (property in overrides) {
        return overrides[property as keyof T];
      }

      const value = Reflect.get(instance, property, instance);

      return typeof value === 'function' ? value.bind(instance) : value;
    },
  });
}

/**
 * Anchors the local paths in a validate call at the workspace
 */
function resolveValidateOptions<
  T extends ValidateOptions | WorkerValidateOptions,
>(powerOnsDirectory: string, options: T): T {
  if (!options?.localIncludeDir) {
    return options;
  }

  return {
    ...options,
    localIncludeDir: resolveLocalPowerOnPath(
      powerOnsDirectory,
      options.localIncludeDir,
    ),
  };
}

/**
 * Wraps an HTTPS client so every local path it is handed is resolved against
 * `GITHUB_WORKSPACE`, and reported changed files always come back as bare,
 * directory-relative names
 */
function withWorkspacePaths(
  client: SymitarHTTPs,
  powerOnsDirectory: string,
): SymitarHTTPs {
  return withOverrides(client, {
    getChangedFiles: async (
      localDirectory,
      remoteDirectory,
      syncMode,
      options,
    ) => {
      const changedFiles = await client.getChangedFiles(
        resolveLocalPowerOnPath(powerOnsDirectory, localDirectory),
        remoteDirectory,
        syncMode,
        options,
      );

      return {
        ...changedFiles,
        deployed: changedFiles.deployed.map((deployedPath) =>
          toDeployedFileName(powerOnsDirectory, deployedPath),
        ),
      };
    },
    validatePowerOn: (localFilePath, options) =>
      client.validatePowerOn(
        resolveLocalPowerOnPath(powerOnsDirectory, localFilePath),
        resolveValidateOptions(powerOnsDirectory, options),
      ),
  });
}

/**
 * Wraps an SSH client - and the validate workers it hands out - the same way
 * as {@link withWorkspacePaths}
 */
function withSshWorkspacePaths(
  client: SymitarSSH,
  powerOnsDirectory: string,
): SymitarSSH {
  return withOverrides(client, {
    getChangedFiles: async (
      symitarConfig,
      localDirectory,
      remoteDirectory,
      syncMode,
      options,
    ) => {
      const changedFiles = await client.getChangedFiles(
        symitarConfig,
        resolveLocalPowerOnPath(powerOnsDirectory, localDirectory),
        remoteDirectory,
        syncMode,
        options,
      );

      return {
        ...changedFiles,
        deployed: changedFiles.deployed.map((deployedPath) =>
          toDeployedFileName(powerOnsDirectory, deployedPath),
        ),
      };
    },
    createValidateWorker: async (symitarConfig) => {
      const worker = await client.createValidateWorker(symitarConfig);

      return withOverrides(worker, {
        validatePowerOn: (localFilePath, options) =>
          worker.validatePowerOn(
            resolveLocalPowerOnPath(powerOnsDirectory, localFilePath),
            resolveValidateOptions(powerOnsDirectory, options),
          ),
      });
    },
  });
}

/**
 * Production dependencies for `@libum-llc/pipelines-core`'s ValidatePowerOn
 * runner.
 *
 * `runValidatePowerOnTask` is host-agnostic and reads nothing from the
 * environment, so every GitHub-specific behaviour has to arrive through this
 * object:
 *
 * - `task` is the `@actions/core`-backed `TaskHost`
 * - the client factories normalize reported changed-file paths so core's
 *   `mapDeployedToChangedFiles` cannot double-prefix them, and resolve every
 *   local path handed to Symitar against `GITHUB_WORKSPACE`
 * - `filterChangedFiles` anchors the `getSkipReasonForFile` stat at
 *   `GITHUB_WORKSPACE` instead of the process working directory
 *
 * Together these mean the task never depends on the process working directory
 * for filesystem access, which is what the pre-v2 `validator.ts` guaranteed by
 * passing `path.join(GITHUB_WORKSPACE, poweronDirectory)` everywhere. The
 * runner itself still holds repo-relative paths - that is deliberate, it keeps
 * its log lines and error names readable via `.replace(directory, '')` - so the
 * translation happens at the Symitar boundary instead.
 */
export const validatePowerOnDependencies: ValidatePowerOnTaskDependencies = {
  task: createGitHubTaskHost(),
  loadConfig: loadValidateConfig,
  validateApiKey,
  createHttpsClient: (config) =>
    withWorkspacePaths(createHTTPsClient(config), config.powerOnsDirectory),
  createSshClient: async (config) =>
    withSshWorkspacePaths(
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
