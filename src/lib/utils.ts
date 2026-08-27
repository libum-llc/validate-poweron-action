import * as core from '@actions/core';

import { execFileSync } from 'child_process';

import { ChangedFile, FileStatus, InputError } from '@libum-llc/pipelines-core';

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
 * Options shared by every git invocation here.
 *
 * `cwd` is pinned to the workspace when the runner provides one, so change
 * detection never depends on the process working directory - the same
 * guarantee `dependencies.ts` makes for filesystem access at the Symitar
 * boundary. It is left unset off-runner (and in unit tests), matching what the
 * pre-v2 implementation did.
 *
 * `maxBuffer` is raised well above `execFileSync`'s 1 MiB default: the diff of
 * a large PowerOn directory can exceed it, and the failure mode is an
 * `ENOBUFS` throw rather than truncated output.
 */
const gitExecOptions = (): {
  cwd?: string;
  encoding: 'utf-8';
  maxBuffer: number;
} => {
  const workspace = process.env.GITHUB_WORKSPACE;

  return {
    ...(workspace ? { cwd: workspace } : {}),
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
  };
};

/**
 * Fails with an actionable message when the ref to diff against does not
 * exist locally.
 *
 * `actions/checkout` defaults to a depth-1 clone that fetches no other refs,
 * so `origin/<base>` is simply absent unless the consumer sets
 * `fetch-depth: 0`. Without this check `git diff` throws
 * `Command failed: git diff --name-status origin/main...` and git's real
 * complaint (`fatal: ambiguous argument`) is left on `error.stderr`, which
 * nothing reads - so the single most common consumer misconfiguration
 * surfaces as an unexplained failure. The pre-v2 implementation probed the ref
 * and said what to do about it; this restores that.
 *
 * @param remoteRef The resolved remote ref, e.g. `origin/main`
 */
const assertRefExists = (remoteRef: string): void => {
  try {
    execFileSync(
      'git',
      ['rev-parse', '--verify', '--quiet', `${remoteRef}^{commit}`],
      {
        ...gitExecOptions(),
        stdio: 'ignore',
      },
    );
  } catch {
    throw new InputError(
      `Target branch '${remoteRef}' not found. actions/checkout defaults to a shallow clone that fetches no other refs, so set 'fetch-depth: 0' on the checkout step (or confirm the branch exists).`,
      'targetBranch',
      { remoteRef },
    );
  }
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

  assertRefExists(remoteRef);

  // execFileSync, not execSync: a git ref may legally contain shell
  // metacharacters (`;`, `$`, `&`, `|`, backticks), and this action runs in
  // public repositories. Passing argv directly means the ref is never parsed
  // by a shell.
  const output = execFileSync(
    'git',
    ['diff', '--name-status', `${remoteRef}...`],
    gitExecOptions(),
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
