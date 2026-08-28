import { execFileSync } from 'child_process';

import { InputError } from '@libum-llc/pipelines-core';

import {
  getInput,
  getBoolInput,
  getRemoteBranchRef,
  getChangedFilesInDir,
  isValidNumber,
  toActionInputName,
} from '../utils';

// Mock dependencies
jest.mock('child_process');

/**
 * Sets a GitHub Actions input using the runner's `INPUT_<NAME>` convention,
 * where `<NAME>` is the kebab-cased `action.yml` input name.
 */
const setActionInput = (actionInputName: string, value: string): void => {
  process.env[`INPUT_${actionInputName.toUpperCase()}`] = value;
};

const clearActionInputs = (): void => {
  Object.keys(process.env).forEach((key) => {
    if (key.startsWith('INPUT_')) {
      delete process.env[key];
    }
  });
};

describe('utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearActionInputs();
  });

  afterEach(() => {
    clearActionInputs();
  });

  describe('toActionInputName', () => {
    it('should convert camelCase pipelines names to kebab-case inputs', () => {
      expect(toActionInputName('symitarHostname')).toBe('symitar-hostname');
      expect(toActionInputName('symNumber')).toBe('sym-number');
      expect(toActionInputName('symitarUserNumber')).toBe(
        'symitar-user-number',
      );
      expect(toActionInputName('symitarUserPassword')).toBe(
        'symitar-user-password',
      );
      expect(toActionInputName('sshUsername')).toBe('ssh-username');
      expect(toActionInputName('sshPassword')).toBe('ssh-password');
      expect(toActionInputName('sshPort')).toBe('ssh-port');
      expect(toActionInputName('apiKey')).toBe('api-key');
      expect(toActionInputName('symitarAppPort')).toBe('symitar-app-port');
      expect(toActionInputName('connectionType')).toBe('connection-type');
      expect(toActionInputName('targetBranch')).toBe('target-branch');
      expect(toActionInputName('validateIgnore')).toBe('validate-ignore');
      expect(toActionInputName('preserveServerFiles')).toBe(
        'preserve-server-files',
      );
      expect(toActionInputName('syncMethod')).toBe('sync-method');
    });

    it('should map powerOnsDirectory to the poweron-directory input', () => {
      // Not a plain camel -> kebab transform ('power-ons-directory')
      expect(toActionInputName('powerOnsDirectory')).toBe('poweron-directory');
    });

    it('should map validateIgnorePowerOns to the validate-ignore input', () => {
      expect(toActionInputName('validateIgnorePowerOns')).toBe(
        'validate-ignore',
      );
    });

    it('should leave single-word names unchanged', () => {
      expect(toActionInputName('debug')).toBe('debug');
    });

    it('should kebab-case output names for setOutput mapping', () => {
      expect(toActionInputName('filesValidated')).toBe('files-validated');
      expect(toActionInputName('filesPassed')).toBe('files-passed');
      expect(toActionInputName('filesFailed')).toBe('files-failed');
    });
  });

  describe('getInput', () => {
    it('should read the kebab-cased action input', () => {
      setActionInput('symitar-hostname', 'symitar.example.com');

      expect(getInput('symitarHostname', false)).toBe('symitar.example.com');
    });

    it('should read a multi-word kebab-cased action input', () => {
      setActionInput('symitar-user-password', 'userpass');

      expect(getInput('symitarUserPassword', false)).toBe('userpass');
    });

    it('should read the overridden poweron-directory input', () => {
      setActionInput('poweron-directory', 'CUSTOM/');

      expect(getInput('powerOnsDirectory', false)).toBe('CUSTOM/');
    });

    it('should return an empty string when the input is not set', () => {
      expect(getInput('targetBranch', false)).toBe('');
    });

    it('should trim surrounding whitespace', () => {
      setActionInput('api-key', '  test-api-key  ');

      expect(getInput('apiKey', false)).toBe('test-api-key');
    });

    it('should throw naming the kebab input when a required input is missing', () => {
      expect(() => getInput('apiKey', true)).toThrow(
        'Input required and not supplied: api-key',
      );
    });

    it('should not throw when a required input is present', () => {
      setActionInput('api-key', 'test-api-key');

      expect(getInput('apiKey', true)).toBe('test-api-key');
    });
  });

  describe('getBoolInput', () => {
    it('should return true when the input is "true"', () => {
      setActionInput('debug', 'true');

      expect(getBoolInput('debug', false)).toBe(true);
    });

    it('should return true when the input is "TRUE"', () => {
      setActionInput('debug', 'TRUE');

      expect(getBoolInput('debug', false)).toBe(true);
    });

    it('should return false when the input is "false"', () => {
      setActionInput('debug', 'false');

      expect(getBoolInput('debug', false)).toBe(false);
    });

    it('should return false when the input is not set', () => {
      expect(getBoolInput('debug', false)).toBe(false);
    });

    it('should default required to false and return false when unset', () => {
      expect(getBoolInput('debug')).toBe(false);
    });

    it('should read the kebab-cased action input', () => {
      setActionInput('some-flag', 'true');

      expect(getBoolInput('someFlag')).toBe(true);
    });

    it('should throw for a value that is not a boolean', () => {
      setActionInput('debug', 'invalid');

      expect(() => getBoolInput('debug', false)).toThrow(TypeError);
    });
  });

  describe('getRemoteBranchRef', () => {
    it('should convert refs/heads/branch to origin/branch', () => {
      const result = getRemoteBranchRef('refs/heads/main');

      expect(result).toBe('origin/main');
    });

    it('should convert refs/heads/feature/test to origin/feature/test', () => {
      const result = getRemoteBranchRef('refs/heads/feature/test');

      expect(result).toBe('origin/feature/test');
    });

    it('should return original ref if not in refs/heads format', () => {
      const result = getRemoteBranchRef('main');

      expect(result).toBe('main');
    });

    it('should handle refs/tags/v1.0.0', () => {
      const result = getRemoteBranchRef('refs/tags/v1.0.0');

      expect(result).toBe('refs/tags/v1.0.0');
    });
  });

  describe('getChangedFilesInDir', () => {
    // GITHUB_WORKSPACE decides whether `cwd` appears in the options object, and
    // it is set on an Actions runner but not on a developer's machine. Pinning
    // it here keeps these cases hermetic - without this the exact-options
    // assertions below pass locally and fail in CI, which is how this was
    // found. The one case that wants a workspace sets it explicitly.
    let workspaceBeforeSuite: string | undefined;

    beforeAll(() => {
      workspaceBeforeSuite = process.env.GITHUB_WORKSPACE;
    });

    beforeEach(() => {
      delete process.env.GITHUB_WORKSPACE;
    });

    afterAll(() => {
      if (workspaceBeforeSuite === undefined) {
        delete process.env.GITHUB_WORKSPACE;
      } else {
        process.env.GITHUB_WORKSPACE = workspaceBeforeSuite;
      }
    });

    it('should parse git diff output correctly', () => {
      const gitOutput = `A\tREPWRITERSPECS/NEW.PO
M\tREPWRITERSPECS/MODIFIED.PO
D\tREPWRITERSPECS/DELETED.PO`;

      (execFileSync as jest.Mock).mockReturnValue(gitOutput);

      const result = getChangedFilesInDir('refs/heads/main', 'REPWRITERSPECS/');

      expect(result).toEqual([
        { filePath: 'REPWRITERSPECS/NEW.PO', status: 'added' },
        { filePath: 'REPWRITERSPECS/MODIFIED.PO', status: 'modified' },
        { filePath: 'REPWRITERSPECS/DELETED.PO', status: 'deleted' },
      ]);
    });

    it('should filter files not in the specified directory', () => {
      const gitOutput = `M\tREPWRITERSPECS/FILE1.PO
M\tOTHERDIR/FILE2.PO
M\tREPWRITERSPECS/FILE3.PO`;

      (execFileSync as jest.Mock).mockReturnValue(gitOutput);

      const result = getChangedFilesInDir('refs/heads/main', 'REPWRITERSPECS/');

      expect(result).toEqual([
        { filePath: 'REPWRITERSPECS/FILE1.PO', status: 'modified' },
        { filePath: 'REPWRITERSPECS/FILE3.PO', status: 'modified' },
      ]);
    });

    it('should handle empty git diff output', () => {
      (execFileSync as jest.Mock).mockReturnValue('');

      const result = getChangedFilesInDir('refs/heads/main', 'REPWRITERSPECS/');

      expect(result).toEqual([]);
    });

    it('should invoke git through argv, never a shell string', () => {
      (execFileSync as jest.Mock).mockReturnValue('');

      getChangedFilesInDir('refs/heads/feature', 'REPWRITERSPECS/');

      expect(execFileSync).toHaveBeenLastCalledWith(
        'git',
        ['diff', '--name-status', 'origin/feature...'],
        { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 },
      );
    });

    it('should not let shell metacharacters in a ref reach a shell', () => {
      (execFileSync as jest.Mock).mockReturnValue('');

      getChangedFilesInDir('refs/heads/a;rm -rf /', 'REPWRITERSPECS/');

      // Passed as a single opaque argv element - never concatenated into a
      // command string a shell would re-parse.
      expect(execFileSync).toHaveBeenLastCalledWith(
        'git',
        ['diff', '--name-status', 'origin/a;rm -rf /...'],
        { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 },
      );
    });

    // The ref is verified before the diff runs so a shallow checkout produces
    // a message that names the fix, rather than git's `fatal: ambiguous
    // argument` being swallowed on an unread `error.stderr`.
    it('should verify the ref exists before diffing against it', () => {
      (execFileSync as jest.Mock).mockReturnValue('');

      getChangedFilesInDir('refs/heads/main', 'REPWRITERSPECS/');

      expect(execFileSync).toHaveBeenNthCalledWith(
        1,
        'git',
        ['rev-parse', '--verify', '--quiet', 'origin/main^{commit}'],
        expect.objectContaining({ stdio: 'ignore' }),
      );
    });

    it('should throw an actionable InputError when the ref is missing', () => {
      (execFileSync as jest.Mock).mockImplementation(
        (_file, args: string[]) => {
          if (args[0] === 'rev-parse') {
            throw new Error('Command failed: git rev-parse --verify --quiet');
          }
          return '';
        },
      );

      expect(() =>
        getChangedFilesInDir('refs/heads/main', 'REPWRITERSPECS/'),
      ).toThrow(InputError);

      expect(() =>
        getChangedFilesInDir('refs/heads/main', 'REPWRITERSPECS/'),
      ).toThrow(/fetch-depth: 0/);
    });

    it('should not run the diff when the ref is missing', () => {
      (execFileSync as jest.Mock).mockImplementation(
        (_file, args: string[]) => {
          if (args[0] === 'rev-parse') {
            throw new Error('missing ref');
          }
          return 'M\tREPWRITERSPECS/SHOULD_NOT_BE_READ.PO';
        },
      );

      expect(() =>
        getChangedFilesInDir('refs/heads/main', 'REPWRITERSPECS/'),
      ).toThrow(InputError);

      const diffCalls = (execFileSync as jest.Mock).mock.calls.filter(
        ([, args]: [string, string[]]) => args[0] === 'diff',
      );
      expect(diffCalls).toHaveLength(0);
    });

    // Change detection must not depend on the process working directory - the
    // same guarantee dependencies.ts makes at the Symitar boundary.
    it('should run git in the workspace when the runner provides one', () => {
      process.env.GITHUB_WORKSPACE = '/home/runner/work/repo/repo';
      (execFileSync as jest.Mock).mockReturnValue('');

      getChangedFilesInDir('refs/heads/main', 'REPWRITERSPECS/');

      expect(execFileSync).toHaveBeenLastCalledWith(
        'git',
        expect.any(Array),
        expect.objectContaining({ cwd: '/home/runner/work/repo/repo' }),
      );
    });

    it('should omit cwd when no workspace is set', () => {
      (execFileSync as jest.Mock).mockReturnValue('');

      getChangedFilesInDir('refs/heads/main', 'REPWRITERSPECS/');

      expect(execFileSync).toHaveBeenLastCalledWith(
        'git',
        expect.any(Array),
        expect.not.objectContaining({ cwd: expect.anything() }),
      );
    });

    // Regression: `git diff --name-status` reports a rename as
    // `R100\tOLD.PO\tNEW.PO`. Taking the first path names the deleted source,
    // which no longer exists on disk - getSkipReasonForFile then drops it and
    // the renamed-to file is never validated.
    it('should take the destination path of a rename, as modified', () => {
      (execFileSync as jest.Mock).mockReturnValue(
        'R100\tREPWRITERSPECS/OLD.PO\tREPWRITERSPECS/NEW.PO',
      );

      expect(
        getChangedFilesInDir('refs/heads/main', 'REPWRITERSPECS/'),
      ).toEqual([{ filePath: 'REPWRITERSPECS/NEW.PO', status: 'modified' }]);
    });

    it('should take the destination path of a copy, as modified', () => {
      (execFileSync as jest.Mock).mockReturnValue(
        'C75\tREPWRITERSPECS/SOURCE.PO\tREPWRITERSPECS/COPY.PO',
      );

      expect(
        getChangedFilesInDir('refs/heads/main', 'REPWRITERSPECS/'),
      ).toEqual([{ filePath: 'REPWRITERSPECS/COPY.PO', status: 'modified' }]);
    });

    it('should filter a rename whose destination is outside the directory', () => {
      (execFileSync as jest.Mock).mockReturnValue(
        'R100\tREPWRITERSPECS/OLD.PO\tOTHERDIR/NEW.PO',
      );

      expect(
        getChangedFilesInDir('refs/heads/main', 'REPWRITERSPECS/'),
      ).toEqual([]);
    });

    it('should map every documented status code to the expected status', () => {
      const gitOutput = `A\tREPWRITERSPECS/ADDED.PO
M\tREPWRITERSPECS/MODIFIED.PO
D\tREPWRITERSPECS/DELETED.PO
R100\tREPWRITERSPECS/OLD.PO\tREPWRITERSPECS/RENAMED.PO
C100\tREPWRITERSPECS/SOURCE.PO\tREPWRITERSPECS/COPIED.PO
T\tREPWRITERSPECS/TYPECHANGED.PO`;

      (execFileSync as jest.Mock).mockReturnValue(gitOutput);

      expect(
        getChangedFilesInDir('refs/heads/main', 'REPWRITERSPECS/'),
      ).toEqual([
        { filePath: 'REPWRITERSPECS/ADDED.PO', status: 'added' },
        { filePath: 'REPWRITERSPECS/MODIFIED.PO', status: 'modified' },
        { filePath: 'REPWRITERSPECS/DELETED.PO', status: 'deleted' },
        { filePath: 'REPWRITERSPECS/RENAMED.PO', status: 'modified' },
        { filePath: 'REPWRITERSPECS/COPIED.PO', status: 'modified' },
        { filePath: 'REPWRITERSPECS/TYPECHANGED.PO', status: 'modified' },
      ]);
    });

    it('should keep spaces in file names intact', () => {
      (execFileSync as jest.Mock).mockReturnValue(
        'M\tREPWRITERSPECS/MY FILE.PO',
      );

      expect(
        getChangedFilesInDir('refs/heads/main', 'REPWRITERSPECS/'),
      ).toEqual([
        { filePath: 'REPWRITERSPECS/MY FILE.PO', status: 'modified' },
      ]);
    });

    it('should drop malformed records with no path', () => {
      (execFileSync as jest.Mock).mockReturnValue(
        'M\nM\tREPWRITERSPECS/FILE.PO',
      );

      expect(
        getChangedFilesInDir('refs/heads/main', 'REPWRITERSPECS/'),
      ).toEqual([{ filePath: 'REPWRITERSPECS/FILE.PO', status: 'modified' }]);
    });
  });

  describe('isValidNumber', () => {
    it('should return true for valid numbers', () => {
      expect(isValidNumber(0)).toBe(true);
      expect(isValidNumber(1)).toBe(true);
      expect(isValidNumber(627)).toBe(true);
      expect(isValidNumber(-1)).toBe(true);
      expect(isValidNumber(3.14)).toBe(true);
    });

    it('should return false for NaN', () => {
      expect(isValidNumber(NaN)).toBe(false);
    });

    it('should return false for non-numbers', () => {
      expect(isValidNumber('123')).toBe(false);
      expect(isValidNumber(null)).toBe(false);
      expect(isValidNumber(undefined)).toBe(false);
      expect(isValidNumber({})).toBe(false);
      expect(isValidNumber([])).toBe(false);
      expect(isValidNumber(true)).toBe(false);
    });

    it('should return true for Infinity', () => {
      expect(isValidNumber(Infinity)).toBe(true);
      expect(isValidNumber(-Infinity)).toBe(true);
    });
  });
});
