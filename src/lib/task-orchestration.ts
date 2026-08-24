import * as core from '@actions/core';

import { SymitarHTTPs, SymitarSSH } from '@libum-llc/symitar';

import {
  DEFAULT_POWERON_DIRECTORY,
  DEFAULT_SSH_PORT,
  determineValidationMode,
  InputError,
  SymNumberError,
  type CommonTaskConfig,
  type RepoConfig,
  type SyncMethod,
  type ValidatePowerOnConfig,
} from '@libum-llc/pipelines-core';

import { getBoolInput, getInput, isValidNumber } from './utils';

// Validation patterns
const HOSTNAME_PATTERN = /^[a-zA-Z0-9.-]+$/;
const MIN_PORT = 1;
const MAX_PORT = 65535;

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
 * `.poweron-pipelines/config.yml`. That schema stayed with the extension —
 * `@libum-llc/pipelines-core`'s `ValidatePowerOnConfig.powerOnsDirectory` is a
 * plain `string` and core validates nothing about it, because loading config is
 * a host concern. A GitHub Action is configured through `action.yml` inputs and
 * has no schema, so the guarantee is restored here instead. It is load-bearing:
 * core's `mapDeployedToChangedFiles` builds `${directory}${name}` with no
 * separator, so a `poweron-directory` of `REPWRITERSPECS` would otherwise yield
 * `REPWRITERSPECSFILE.PO`.
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
 * Warns when the resolved refs mean the run will validate nothing.
 *
 * Core's `determineValidationMode` returns `'none'` unless one of the
 * two refs looks like `refs/heads/<name>`. On a tag or release run
 * `GITHUB_REF` is `refs/tags/v1.0.0`, and with no `target-branch` input both
 * refs fail that test - so the runner skips both change-detection branches,
 * reports `0/0/0`, never contacts the Symitar host, and exits 0. A validation
 * gate that is green because it validated nothing is worse than a red one, so
 * the condition is surfaced loudly here.
 *
 * This lives in the adapter rather than in core because core is host-agnostic
 * and knows nothing about `GITHUB_REF`; the Azure agent sets
 * `Build.SourceBranch` to a `refs/heads/` ref for the pipeline shapes that
 * task supports, so the condition does not arise there.
 *
 * @param targetBranch The resolved target branch ref, or ''
 * @param buildBranch The build branch ref (`GITHUB_REF`)
 */
function warnIfNothingWillBeValidated(
  targetBranch: string,
  buildBranch: string,
): void {
  if (determineValidationMode(targetBranch, buildBranch) !== 'none') {
    return;
  }

  core.warning(
    `No branch ref resolved (GITHUB_REF is '${buildBranch || 'unset'}' and no target-branch was provided), ` +
      'so no PowerOn files will be validated and this step will succeed without contacting Symitar. ' +
      'This happens on tag and release runs. Set the `target-branch` input to compare against a branch, ' +
      'or run this action on a push/pull_request event so GITHUB_REF is a refs/heads ref.',
  );
}

/**
 * Loads configuration for Validate tasks
 */
export function loadValidateConfig(): ValidatePowerOnConfig {
  const commonConfig = loadCommonConfig();

  // Resolve the target branch, converting it to a ref at this boundary so the
  // vendored lib code (TARGET_BRANCH_PATTERN, getRemoteBranchRef) is unchanged
  const targetBranchName: string = resolveTargetBranchName();
  const targetBranch: string = targetBranchName
    ? `refs/heads/${targetBranchName}`
    : '';

  warnIfNothingWillBeValidated(targetBranch, commonConfig.buildBranch);

  // validateIgnore and preserveServerFiles come exclusively from the repo
  // config, which parses them from these same two inputs
  const validateIgnore = commonConfig.repoConfig.validateIgnorePowerOns;
  const preserveServerFiles = commonConfig.repoConfig.preserveServerFiles;

  // Validate the connection type (https or ssh).
  //
  // The Azure DevOps extension declares `connectionType` as a two-option
  // `pickList` in `task.json`, so core's runner can safely treat the input as
  // `'https' | 'ssh'`. `action.yml` has no equivalent constraint, and the
  // runner branches `if (connectionType === 'https') { ... } else { SSH }`
  // - meaning a typo such as `htpps` would otherwise silently run the SSH
  // path against an HTTPS-configured job. The guarantee is restored here.
  //
  // The value is deliberately not returned on the config: core's runner reads
  // this input itself through the `TaskHost`, and `ValidatePowerOnConfig` is
  // part of the package's public API, so it cannot carry a field core does not
  // define.
  const connectionType = getInput('connectionType', false) || 'https';
  if (connectionType !== 'https' && connectionType !== 'ssh') {
    throw new InputError(
      `Invalid connection type: '${connectionType}'. Must be 'https' or 'ssh'`,
      'connectionType',
    );
  }

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
 * Creates a SymitarHTTPs client with the provided configuration.
 *
 * The HTTPS client delegates change detection and file transfer to SSH, so an
 * SSH client is always in play - but it builds its own from the `sshConfig`
 * argument and `end()` closes it again. No SSH client is accepted here on
 * purpose: core types `ValidatePowerOnTaskDependencies.createHttpsClient` as a
 * single-argument factory, so nothing on the ValidatePowerOn call path could
 * supply one. (The SynchronizeDirectory runner does share a client, and core
 * types *that* factory with the second argument - the asymmetry is real.)
 */
export function createHTTPsClient(config: ValidatePowerOnConfig): SymitarHTTPs {
  if (!config.symitarAppPort) {
    throw new InputError(
      'symitarAppPort is required when using HTTPS connection',
      'symitarAppPort',
    );
  }

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
