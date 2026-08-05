import * as core from '@actions/core';

import { getInput as getActionInput, toActionInputName } from './utils';

/**
 * GitHub Actions stand-in for `azure-pipelines-task-lib/task`.
 *
 * The vendored task runners are copied byte-identically from
 * `poweron-pipelines` and reach their host through
 * `import * as tl from 'azure-pipelines-task-lib/task'`. That specifier is
 * remapped to this module (see `tsconfig.json` `paths` and the jest
 * `moduleNameMapper`), so the runners keep compiling untouched while every
 * host call lands on `@actions/core`.
 *
 * Only the surface the runners actually use is implemented: `getInput`,
 * `warning` and `setVariable`.
 */

/**
 * Reads an `action.yml` input using the pipelines (camelCase) input name
 * @param name The camelCase input name used by the vendored runner
 * @param required Whether the input is required or not
 */
export const getInput = (name: string, required?: boolean): string =>
  getActionInput(name, required ?? false);

/**
 * Emits a warning annotation
 * @param message The warning message
 */
export const warning = (message: string): void => core.warning(message);

/**
 * Publishes a task output.
 *
 * Azure Pipelines output variables are named in camelCase; the equivalent
 * `action.yml` outputs are kebab-case, so the name is translated on the way
 * out (`filesValidated` -> `files-validated`). The `secret` and `isOutput`
 * flags exist to match the `azure-pipelines-task-lib` signature: a GitHub
 * Actions output is always a step output, and secret values are masked with
 * `core.setSecret` rather than at the variable level.
 *
 * @param name The camelCase output variable name
 * @param val The value to publish
 * @param secret Whether the value should be masked in the log
 */
export const setVariable = (
  name: string,
  val: string,
  secret?: boolean,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  isOutput?: boolean,
): void => {
  if (secret) {
    core.setSecret(val);
  }
  core.setOutput(toActionInputName(name), val);
};
