import * as core from '@actions/core';

import { execFileSync } from 'child_process';

import { ChangedFile, FileStatus } from '@libum-llc/pipelines-core';

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
 *
 * `git diff --name-status` emits one tab-separated record per changed file:
 * `<status>\t<path>`, except for renames and copies, which carry both
 * endpoints - `R100\tOLD.PO\tNEW.PO`. Taking the first path there would name
 * the *deleted source*, which no longer exists on disk; `getSkipReasonForFile`
 * then fails to stat it and drops it, so the renamed-to file is never
 * validated. The destination path is used instead, with a `modified` status.
 *
 * @param targetBranch The target branch to compare against
 * @param directory The directory to check for changes
 */
export const getChangedFilesInDir = (
  targetBranch: string,
  directory: string,
): ChangedFile[] => {
  const remoteRef = getRemoteBranchRef(targetBranch);
  // execFileSync, not execSync: a git ref may legally contain shell
  // metacharacters (`;`, `$`, `&`, `|`, backticks), and this action runs in
  // public repositories. Passing argv directly means the ref is never parsed
  // by a shell.
  const output = execFileSync(
    'git',
    ['diff', '--name-status', `${remoteRef}...`],
    { encoding: 'utf-8' },
  );

  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split('\t').filter(Boolean))
    .filter((fields) => fields.length >= 2)
    .map((fields) => {
      // Status codes may carry a similarity score ('R100', 'C75'); only the
      // leading letter is the status itself.
      const statusCode = fields[0][0];
      const isRenameOrCopy = statusCode === 'R' || statusCode === 'C';
      const filePath = isRenameOrCopy ? fields[fields.length - 1] : fields[1];
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
