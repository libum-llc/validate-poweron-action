import {
  SymitarHTTPs,
  SymitarSSH,
  type SymitarSyncCompareMode,
  SymitarSyncTransport,
} from '@libum-llc/symitar';

import { getBoolInput, getInput, isValidNumber } from './utils';
import { DEFAULT_POWERON_DIRECTORY, DEFAULT_SSH_PORT } from './constants';
import { RepoConfig } from './types';
import { validateApiKey } from './subscription';
import { SymNumberError, InputError } from './errors';

// Validation patterns
const HOSTNAME_PATTERN = /^[a-zA-Z0-9.-]+$/;
const MIN_PORT = 1;
const MAX_PORT = 65535;
export const DEFAULT_SYNC_COMPARE_MODE: SymitarSyncCompareMode = 'quick';

// Ref prefixes that are rejected on the targetBranch input. The input takes a
// bare branch name; the `refs/heads/` prefix is added at this boundary so the
// vendored lib code keeps working on Azure-shaped refs.
const REJECTED_TARGET_BRANCH_PREFIXES = ['origin/', 'refs/heads/'];

/**
 * Validates a hostname format
 */
function validateHostname(hostname: string, inputName: string): void {
  if (!HOSTNAME_PATTERN.test(hostname)) {
    throw new InputError(
      `Invalid hostname format: ${hostname}. Must contain only alphanumeric characters, dots, and hyphens.`,
      inputName,
      { value: hostname },
    );
  }
}

/**
 * Validates a port number is within valid range
 */
function validatePort(port: number, inputName: string): void {
  if (isNaN(port) || port < MIN_PORT || port > MAX_PORT) {
    throw new InputError(
      `Invalid port: ${port}. Must be between ${MIN_PORT}-${MAX_PORT}.`,
      inputName,
      { value: port },
    );
  }
}

/**
 * Normalizes a directory input to the canonical form the vendored lib code
 * expects: forward slashes and exactly one trailing slash.
 *
 * The Azure DevOps extension enforces this with a zod `directoryPathSchema`
 * ("must end with a forward slash") when it parses
 * `.poweron-pipelines/config.yml`. A GitHub Action is configured through
 * `action.yml` inputs and has no schema, so the guarantee is restored here
 * instead. It is load-bearing: `mapDeployedToChangedFiles` builds
 * `${directory}${name}` with no separator, so a `poweron-directory` of
 * `REPWRITERSPECS` would otherwise yield `REPWRITERSPECSFILE.PO`.
 *
 * @param value The raw directory input
 */
function toDirectoryPath(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/').replace(/\/+$/, '');

  return normalized ? `${normalized}/` : '';
}

function parseListInput(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * Common configuration shared across all tasks
 */
export interface CommonTaskConfig {
  logPrefix: string;
  buildBranch: string;
  buildBranchName: string;
  repoConfig: RepoConfig;
  apiKey: string;
  powerOnsDirectory: string;
  symitarHostname: string;
  sshUsername: string;
  sshPassword: string;
  sshPort: number;
  symNumber: number;
  symitarUserNumber: string;
  symitarUserPassword: string;
  debug: boolean;
}

/**
 * Sync method type for file synchronization transport
 */
export type SyncMethod = 'sftp' | 'rsync';

/**
 * Configuration specific to Validate tasks
 */
export interface ValidateTaskConfig extends CommonTaskConfig {
  targetBranch: string;
  targetBranchName: string;
  validateIgnore: string[];
  preserveServerFiles: string[];
  syncMethod: SyncMethod;
  symitarAppPort?: number;
}

/**
 * Builds the repository configuration from action inputs.
 *
 * The Azure DevOps extension reads this from `.poweron-pipelines/config.yml`;
 * a GitHub Action is configured entirely through `action.yml` inputs, so the
 * same shape is assembled from those instead.
 */
function buildRepoConfigFromInputs(): RepoConfig {
  return {
    inputs: {
      powerOnsDirectory: toDirectoryPath(
        getInput('powerOnsDirectory', false) || DEFAULT_POWERON_DIRECTORY,
      ),
      letterFilesDirectory: 'LETTERSPECS/',
      dataFilesDirectory: 'DATAFILES/',
      helpFilesDirectory: 'HELPFILES/',
    },
    branchSymNumbers: {},
    installPowerOns: [],
    validateIgnorePowerOns: parseListInput(getInput('validateIgnore', false)),
    preserveServerFiles: parseListInput(getInput('preserveServerFiles', false)),
  };
}

/**
 * Resolves the bare target branch name to compare against.
 *
 * Defaults to the base ref of a pull request, and can be overridden with the
 * `target-branch` input. The input takes a bare branch name ('main'); a
 * ref-shaped value is rejected rather than silently rewritten.
 */
function resolveTargetBranchName(): string {
  const targetBranchInput = getInput('targetBranch', false).trim();

  if (targetBranchInput) {
    const rejectedPrefix = REJECTED_TARGET_BRANCH_PREFIXES.find((prefix) =>
      targetBranchInput.startsWith(prefix),
    );

    if (rejectedPrefix) {
      throw new InputError(
        `Invalid target-branch: '${targetBranchInput}'. Expected a bare branch name such as 'main', not a '${rejectedPrefix}' prefixed ref.`,
        'targetBranch',
        { value: targetBranchInput },
      );
    }

    return targetBranchInput;
  }

  if (process.env.GITHUB_EVENT_NAME === 'pull_request') {
    return (process.env.GITHUB_BASE_REF || '').trim();
  }

  return '';
}

/**
 * Loads common configuration used by all tasks
 */
function loadCommonConfig(): CommonTaskConfig {
  const logPrefix = '[Main]';

  // Build repository configuration from action inputs
  const repoConfig: RepoConfig = buildRepoConfigFromInputs();

  // Get branch information
  const buildBranch: string = process.env.GITHUB_REF || '';
  const buildBranchName: string = buildBranch.replace(/^refs\/heads\//, '');

  // Get task inputs
  const apiKey: string = getInput('apiKey', true).trim();
  const powerOnsDirectory: string = toDirectoryPath(
    getInput('powerOnsDirectory', false) || repoConfig.inputs.powerOnsDirectory,
  );

  // Log the loaded configuration
  console.info(
    `${logPrefix} Loaded repository configuration:\n${JSON.stringify(
      repoConfig,
      null,
      2,
    )
      .split('\n')
      .map((line) => `${logPrefix} ${line}`)
      .join('\n')}`,
  );

  // Get Symitar connection inputs
  const symitarHostname: string = getInput('symitarHostname', true);
  validateHostname(symitarHostname, 'symitarHostname');

  const sshUsername: string = getInput('sshUsername', true);
  const sshPassword: string = getInput('sshPassword', true);
  const sshPort: number = parseInt(
    getInput('sshPort', false) || DEFAULT_SSH_PORT,
    10,
  );
  validatePort(sshPort, 'sshPort');

  // The sym number is supplied directly as an input; it is a number, never a
  // zero-padded string. Padding is the Symitar client's concern.
  const symNumberInput: string = getInput('symNumber', false).trim();
  const symNumber: number = symNumberInput ? Number(symNumberInput) : NaN;

  const symitarUserNumber: string = getInput('symitarUserNumber', true);
  const symitarUserPassword: string = getInput('symitarUserPassword', true);
  const debug: boolean = getBoolInput('debug', false);

  // Validate symNumber
  if (!isValidNumber(symNumber)) {
    throw new SymNumberError(
      `No valid symNumber found for build branch (${buildBranchName}). Provide the 'sym-number' input as a number.`,
      buildBranchName,
    );
  }

  return {
    logPrefix,
    buildBranch,
    buildBranchName,
    repoConfig,
    apiKey,
    powerOnsDirectory,
    symitarHostname,
    sshUsername,
    sshPassword,
    sshPort,
    symNumber,
    symitarUserNumber,
    symitarUserPassword,
    debug,
  };
}

/**
 * Loads configuration for Validate tasks
 */
export function loadValidateConfig(): ValidateTaskConfig {
  const commonConfig = loadCommonConfig();

  // Resolve the target branch, converting it to a ref at this boundary so the
  // vendored lib code (TARGET_BRANCH_PATTERN, getRemoteBranchRef) is unchanged
  const targetBranchName: string = resolveTargetBranchName();
  const targetBranch: string = targetBranchName
    ? `refs/heads/${targetBranchName}`
    : '';

  // validateIgnore comes exclusively from the repo config
  const validateIgnore = commonConfig.repoConfig.validateIgnorePowerOns;
  const preserveServerFilesInput = getInput('preserveServerFiles', false) || '';
  const preserveServerFiles =
    preserveServerFilesInput.trim().length > 0
      ? parseListInput(preserveServerFilesInput)
      : commonConfig.repoConfig.preserveServerFiles;

  // Parse sync method (sftp or rsync)
  const syncMethodInput = getInput('syncMethod', false) || 'sftp';
  if (syncMethodInput !== 'sftp' && syncMethodInput !== 'rsync') {
    throw new InputError(
      `Invalid sync method: '${syncMethodInput}'. Must be 'sftp' or 'rsync'`,
      'syncMethod',
    );
  }
  const syncMethod: SyncMethod = syncMethodInput;

  // Parse symitar app port (optional, only for HTTPS)
  const symitarAppPortInput = getInput('symitarAppPort', false);
  let symitarAppPort: number | undefined;
  if (symitarAppPortInput) {
    symitarAppPort = parseInt(symitarAppPortInput, 10);
    validatePort(symitarAppPort, 'symitarAppPort');
  }

  return {
    ...commonConfig,
    targetBranch,
    targetBranchName,
    validateIgnore,
    preserveServerFiles,
    syncMethod,
    symitarAppPort,
  };
}

/**
 * Maps our sync method string to the Symitar transport enum
 */
export function getSyncTransport(method: SyncMethod): SymitarSyncTransport {
  switch (method) {
    case 'sftp':
      return SymitarSyncTransport.SFTP;
    case 'rsync':
      return SymitarSyncTransport.RSYNC;
    default:
      throw new InputError(`Invalid sync method: ${method}`, 'syncMethod');
  }
}

/**
 * Creates a SymitarHTTPs client with the provided configuration.
 *
 * An SSH client is always attached: the HTTPS client delegates change
 * detection and file transfer to SSH, and `getFileModificationTime`,
 * `createInstallWorker` and `createUninstallWorker` only exist there. Callers
 * that already hold a connected SSH client pass it in; otherwise one is built
 * from the same credentials.
 */
export function createHTTPsClient(
  config: ValidateTaskConfig,
  sshClient?: SymitarSSH,
): SymitarHTTPs {
  if (!config.symitarAppPort) {
    throw new InputError(
      'symitarAppPort is required when using HTTPS connection',
      'symitarAppPort',
    );
  }

  const attachedSSHClient =
    sshClient ??
    new SymitarSSH(
      {
        host: config.symitarHostname,
        port: config.sshPort,
        username: config.sshUsername,
        password: config.sshPassword,
      },
      config.debug ? 'debug' : 'info',
    );

  return new SymitarHTTPs(
    `https://${config.symitarHostname}:${config.symitarAppPort}`,
    {
      symNumber: config.symNumber,
      symitarUserNumber: config.symitarUserNumber,
      symitarUserPassword: config.symitarUserPassword,
    },
    config.debug ? 'debug' : 'info',
    {
      port: config.sshPort,
      username: config.sshUsername,
      password: config.sshPassword,
    },
    { sshClient: attachedSSHClient },
  );
}

/**
 * Creates a SymitarSSH client with the provided configuration
 */
export async function createSSHClient(
  config: CommonTaskConfig,
): Promise<SymitarSSH> {
  const client = new SymitarSSH(
    {
      host: config.symitarHostname,
      port: config.sshPort,
      username: config.sshUsername,
      password: config.sshPassword,
    },
    config.debug ? 'debug' : 'info',
  );

  await client.isReady;

  return client;
}

/**
 * Validates the API key for the given hostname
 */
export async function validateTaskApiKey(
  apiKey: string,
  hostname: string,
): Promise<void> {
  await validateApiKey(apiKey, hostname);
}
