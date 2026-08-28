import * as core from '@actions/core';

import {
  runValidatePowerOnTask,
  PowerOnError,
  AuthenticationError,
  ConnectionError,
  InputError,
  SymNumberError,
  ValidationError,
} from '@libum-llc/pipelines-core';

import { exitWhenFlushed } from './lib/exit';
import { validatePowerOnDependencies } from './validate/dependencies';
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
 * Maps `@libum-llc/pipelines-core`'s typed errors onto `core.setFailed`,
 * preserving the per-error-type messaging quality of the pre-v2 `main.ts`
 * (host/port for connection failures, a masked API key, stack traces routed to
 * `core.debug`).
 *
 * `AuthenticationError.apiKeyPrefix` is deliberately never printed - only
 * whether it is present. It carries the first 8 characters of the API key, and
 * `core.setSecret` masks whole registered values, not substrings of them, so
 * emitting the prefix would leak it past the mask in a public repository's
 * logs. Each invalid file is reported through `core.error()`, which GitHub
 * Actions renders as its own error annotation.
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
  try {
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

    const message = await runValidatePowerOnTask(validatePowerOnDependencies);
    core.info(`${logPrefix} ${message}`);
  } catch (error) {
    reportFailure(error);
  }
}

/**
 * Reports a failure, and cannot itself fail silently.
 *
 * Everything below the entry point resolves the exit code from
 * `process.exitCode`, which `core.setFailed` is what sets. So anything that
 * throws *before* `setFailed` runs leaves the exit code unset, and the step
 * goes green on a genuine failure. `handleError` has such a path:
 * `JSON.stringify(error.context)` runs before its `setFailed` and throws on a
 * circular or BigInt-bearing context, and `context` is a
 * `Record<string, unknown>` populated by callers. Rather than audit every
 * reporting path for throw-safety forever, failure is recorded here even when
 * reporting it is what broke.
 *
 * @param error The error to report
 */
function reportFailure(error: unknown): void {
  try {
    handleError(error);
  } catch (reportingError) {
    process.exitCode = 1;
    core.setFailed(
      `${logPrefix} Failed while reporting an error (${
        reportingError instanceof Error
          ? reportingError.message
          : String(reportingError)
      }). Original error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Resolves the exit code to terminate with.
 *
 * `core.setFailed` records failure by assigning `process.exitCode`, so honour
 * whatever it set and default to success.
 */
export function resolveExitCode(
  exitCode: number | string | null | undefined,
): number {
  return typeof exitCode === 'number' ? exitCode : 0;
}

// `run` is exported so tests can invoke it directly and assert on its
// behavior; the module is only self-executing when it is the actual Action
// entry point (`node dist/index.js`), not when imported by a test.
//
// The explicit `process.exit` is load-bearing, not defensive. The Symitar
// client can leave a handle on the event loop that outlives the connection
// teardown, so once the task resolves Node has no reason to exit and the step
// hangs until the job timeout — observed live as a 14-minute hang *after*
// "Successfully validated all changed PowerOns" had already been logged, with
// the step then reported as a failure despite the validation having passed.
// poweron-pipelines does the same thing at the end of `executeTask`
// (task-orchestration.ts: `process.exit(0)` / `process.exit(1)`); that call
// was dropped here along with the rest of the Azure-specific wrapper, taking
// the process teardown with it.
/* istanbul ignore next */
if (require.main === module) {
  void run()
    .catch((error: unknown) => {
      // `run` catches its own failures, so reaching here means the reporting
      // path itself threw. Never let that resolve to a green step.
      process.exitCode = 1;
      core.setFailed(
        `${logPrefix} Unhandled error: ${error instanceof Error ? error.message : String(error)}`,
      );
    })
    .finally(() => {
      exitWhenFlushed(resolveExitCode(process.exitCode));
    });
}
