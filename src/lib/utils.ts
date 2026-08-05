import * as core from '@actions/core';

import { execSync } from 'child_process';
import { ChangedFile, FileStatus } from './types';

/**
 * Input names whose `action.yml` spelling is not a plain camelCase to
 * kebab-case transform of the pipelines input name.
 */
const INPUT_NAME_OVERRIDES: Record<string, string> = {
  powerOnsDirectory: 'poweron-directory',
  validateIgnorePowerOns: 'validate-ignore',
};

/**
 * Translates a pipelines (camelCase) input name into this action's
 * kebab-case `action.yml` input name
 * @param name The camelCase input name
 */
export const toActionInputName = (name: string): string =>
  INPUT_NAME_OVERRIDES[name] ??
  name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

/**
 * Gets the input from the GitHub Actions runner
 * @param name The name of the input
 * @param required Whether the input is required or not
 */
export const getInput = (name: string, required: boolean): string =>
  core.getInput(toActionInputName(name), { required });

/**
 * Gets a boolean input from the GitHub Actions runner, defaulting to false
 * when the input is not set
 * @param name The name of the boolean input
 * @param required Whether the input is required or not
 */
export const getBoolInput = (name: string, required = false): boolean => {
  const inputName = toActionInputName(name);
  if (!core.getInput(inputName, { required })) {
    return false;
  }
  return core.getBooleanInput(inputName);
};

/**
 * Converts a Git ref like 'refs/heads/SYM627' to 'origin/SYM627'
 */
export const getRemoteBranchRef = (ref: string): string => {
  const match = ref.match(/^refs\/heads\/(.+)$/);
  return match ? `origin/${match[1]}` : ref;
};

/**
 * Returns a list of changed files in the current branch
 * @param targetBranch The target branch to compare against
 * @param directory The directory to check for changes
 */
export const getChangedFilesInDir = (
  targetBranch: string,
  directory: string,
): ChangedFile[] => {
  const remoteRef = getRemoteBranchRef(targetBranch);
  const output = execSync(`git diff --name-status ${remoteRef}...`, {
    encoding: 'utf-8',
  });

  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [statusCode, filePath] = line.split(/\s+/, 2);
      const status: FileStatus =
        statusCode === 'A'
          ? 'added'
          : statusCode === 'D'
            ? 'deleted'
            : 'modified';

      return { filePath, status };
    })
    .filter(({ filePath }) => filePath.startsWith(directory));
};

/**
 * Whether the given value is a valid number
 * @param value The value to check
 */
export const isValidNumber = (value: unknown): value is number =>
  typeof value === 'number' && !isNaN(value);
