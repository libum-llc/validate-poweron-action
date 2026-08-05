import * as core from '@actions/core';

import { runValidatePowerOnTask } from './validate/run';
import { validatePowerOnDependencies } from './validate/dependencies';
import {
  PowerOnError,
  AuthenticationError,
  ConnectionError,
  InputError,
  SymNumberError,
  ValidationError,
} from './lib/errors';
import { version } from '../package.json';

const logPrefix = '[ValidatePowerOn]';

/**
 * Logs an error's stack trace at debug level, matching the pre-v2 `main.ts`
 * behavior of surfacing stack traces without polluting the normal log output.
 */
function logStack(error: Error): void {
  if (error.stack) {
    core.debug(`${logPrefix} Stack trace: ${error.stack}`);
  }
}

/**
 * Maps the vendored `errors.ts` typed errors onto `core.setFailed`, preserving
 * the per-error-type messaging quality of the pre-v2 `main.ts` (host/port for
 * connection failures, a masked API key, stack traces routed to `core.debug`).
 *
 * Deliberately does not use `ValidationError.getAzureFormattedMessage()` - it
 * emits Azure Pipelines `##[error]` log commands, which GitHub Actions does
 * not interpret and would print as literal text. Each invalid file is instead
 * reported through `core.error()`, which GitHub Actions renders as its own
 * error annotation.
 */
function handleError(error: unknown): void {
  if (error instanceof AuthenticationError) {
    core.error(`${logPrefix} Authentication failed: ${error.message}`);
    core.error(
      `${logPrefix} API Key: ${error.apiKeyPrefix ? '***' : 'not provided'}`,
    );
    if (error.hostname) {
      core.error(`${logPrefix} Host: ${error.hostname}`);
    }
    logStack(error);
    core.setFailed(`API key validation failed: ${error.message}`);
    return;
  }

  if (error instanceof ConnectionError) {
    core.error(`${logPrefix} Connection failed: ${error.message}`);
    if (error.hostname) {
      core.error(
        `${logPrefix} Host: ${error.hostname}${error.port ? `:${error.port}` : ''}`,
      );
    }
    if (error.originalError) {
      core.error(`${logPrefix} Original error: ${error.originalError.message}`);
      if (error.originalError.stack) {
        core.debug(
          `${logPrefix} Original stack trace: ${error.originalError.stack}`,
        );
      }
    }
    logStack(error);
    core.setFailed(`Failed to connect to license server: ${error.message}`);
    return;
  }

  if (error instanceof InputError) {
    core.error(
      `${logPrefix} Invalid input${error.inputName ? ` '${error.inputName}'` : ''}: ${error.message}`,
    );
    logStack(error);
    core.setFailed(error.message);
    return;
  }

  if (error instanceof SymNumberError) {
    core.error(`${logPrefix} ${error.message}`);
    if (error.branchName) {
      core.error(`${logPrefix} Branch: ${error.branchName}`);
    }
    logStack(error);
    core.setFailed(error.message);
    return;
  }

  if (error instanceof ValidationError) {
    if (error.invalidFiles && error.invalidFiles.length > 0) {
      core.error(
        `${logPrefix} Validation failed for ${error.invalidFiles.length} file(s):`,
      );
      for (const file of error.invalidFiles) {
        core.error(`${logPrefix} ${file.name}:`);
        for (const line of file.errors.split('\n')) {
          core.error(`${logPrefix}   ${line}`);
        }
      }
    }
    logStack(error);
    core.setFailed(error.message);
    return;
  }

  if (error instanceof PowerOnError) {
    core.error(`${logPrefix} ${error.message}`);
    if (error.context && Object.keys(error.context).length > 0) {
      core.error(`${logPrefix} Context: ${JSON.stringify(error.context)}`);
    }
    logStack(error);
    core.setFailed(error.message);
    return;
  }

  if (error instanceof Error) {
    core.error(`${logPrefix} Unexpected error: ${error.message}`);
    logStack(error);
    core.setFailed(error.message);
    return;
  }

  core.error(`${logPrefix} Unknown error: ${String(error)}`);
  core.setFailed(String(error));
}

export async function run(): Promise<void> {
  // Mask sensitive inputs before any logging can occur. Guard against empty
  // strings: core.setSecret('') registers an empty mask, which the runner
  // warns about on every subsequent log line.
  const apiKey = core.getInput('api-key');
  const symitarUserPassword = core.getInput('symitar-user-password');
  const sshPassword = core.getInput('ssh-password');
  if (apiKey) core.setSecret(apiKey);
  if (symitarUserPassword) core.setSecret(symitarUserPassword);
  if (sshPassword) core.setSecret(sshPassword);

  core.info(`${logPrefix} Starting PowerOn validation (v${version})`);

  try {
    const message = await runValidatePowerOnTask(validatePowerOnDependencies);
    core.info(`${logPrefix} ${message}`);
  } catch (error) {
    handleError(error);
  }
}

// `run` is exported so tests can invoke it directly and assert on its
// behavior; the module is only self-executing when it is the actual Action
// entry point (`node dist/index.js`), not when imported by a test.
/* istanbul ignore next */
if (require.main === module) {
  void run();
}
