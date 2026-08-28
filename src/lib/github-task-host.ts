import * as core from '@actions/core';

import { type TaskHost } from '@libum-llc/pipelines-core';

import { getInput as getActionInput, toActionInputName } from './utils';

/**
 * The GitHub Actions implementation of {@link TaskHost}.
 *
 * Two things about it are load-bearing.
 *
 * **Name translation.** Core names its inputs and outputs the way the Azure
 * DevOps extension does — camelCase (`connectionType`, `filesValidated`) —
 * because that is the vocabulary the shared task runners were written in.
 * `action.yml` spells the same things in kebab-case, so every name crossing
 * this boundary goes through {@link toActionInputName}.
 *
 * **`setOutput` must be a real step output.** `TaskHost.setOutput` exists so
 * core never has to know that Azure's `tl.setVariable` needs a 4th `isOutput`
 * argument to be readable by a later step. The GitHub equivalent of that
 * `isOutput: true` behaviour is `@actions/core`'s `setOutput`, which emits the
 * `set-output` file command the runner turns into `steps.<id>.outputs.<name>` —
 * **not** `exportVariable`, which writes a process environment variable into
 * `GITHUB_ENV` and never appears under `steps.<id>.outputs`. Getting this wrong
 * fails silently: the step still succeeds, still logs its summary, and the
 * consuming workflow simply reads an empty string. `.github/workflows/
 * live-integration.yml` asserts on `files-validated`/`files-passed`/
 * `files-failed` for exactly this reason.
 */
export function createGitHubTaskHost(): TaskHost {
  return {
    getInput: (name, required) => getActionInput(name, required ?? false),
    setOutput: (name, value) => core.setOutput(toActionInputName(name), value),
    setSecret: (value) => core.setSecret(value),
    info: (message) => core.info(message),
    warning: (message) => core.warning(message),
    error: (message) => core.error(message),
    debug: (message) => core.debug(message),
  };
}
