import * as core from '@actions/core';

import { InputError, SymNumberError } from '@libum-llc/pipelines-core';

import { loadValidateConfig } from '../task-orchestration';

let warningSpy: jest.SpyInstance;

/**
 * The minimum set of `action.yml` inputs required to load a config.
 */
const BASE_INPUTS: Record<string, string> = {
  'api-key': 'test-api-key',
  'symitar-hostname': 'symitar.example.com',
  'ssh-username': 'testuser',
  'ssh-password': 'testpass',
  'symitar-user-number': '1234',
  'symitar-user-password': 'userpass',
  'sym-number': '627',
};

const setActionInputs = (inputs: Record<string, string>): void => {
  Object.entries(inputs).forEach(([name, value]) => {
    process.env[`INPUT_${name.toUpperCase()}`] = value;
  });
};

const clearActionInputs = (): void => {
  Object.keys(process.env).forEach((key) => {
    if (key.startsWith('INPUT_')) {
      delete process.env[key];
    }
  });
};

describe('task-orchestration', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    clearActionInputs();
    delete process.env.GITHUB_REF;
    delete process.env.GITHUB_BASE_REF;
    delete process.env.GITHUB_EVENT_NAME;

    process.env.GITHUB_REF = 'refs/heads/feature/test';
    setActionInputs(BASE_INPUTS);

    // Suppress the repo config banner during tests
    jest.spyOn(console, 'info').mockImplementation(() => {});
    warningSpy = jest.spyOn(core, 'warning').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    clearActionInputs();
    delete process.env.GITHUB_REF;
    delete process.env.GITHUB_BASE_REF;
    delete process.env.GITHUB_EVENT_NAME;
  });

  describe('loadValidateConfig', () => {
    it('should load validate configuration from action inputs', () => {
      const config = loadValidateConfig();

      expect(config.logPrefix).toBe('[Main]');
      expect(config.buildBranch).toBe('refs/heads/feature/test');
      expect(config.buildBranchName).toBe('feature/test');
      expect(config.apiKey).toBe('test-api-key');
      expect(config.symitarHostname).toBe('symitar.example.com');
      expect(config.sshUsername).toBe('testuser');
      expect(config.sshPassword).toBe('testpass');
      expect(config.sshPort).toBe(22);
      expect(config.symNumber).toBe(627);
      expect(config.symitarUserNumber).toBe('1234');
      expect(config.symitarUserPassword).toBe('userpass');
      expect(config.powerOnsDirectory).toBe('REPWRITERSPECS/');
      expect(config.syncMethod).toBe('sftp');
      expect(config.debug).toBe(false);
      expect(config.symitarAppPort).toBeUndefined();
      expect(config.targetBranch).toBe('');
      expect(config.targetBranchName).toBe('');
    });

    it('should trim the api-key input', () => {
      setActionInputs({ 'api-key': '  test-api-key  ' });

      expect(loadValidateConfig().apiKey).toBe('test-api-key');
    });

    it('should throw when a required input is missing', () => {
      delete process.env['INPUT_API-KEY'];

      expect(() => loadValidateConfig()).toThrow(
        'Input required and not supplied: api-key',
      );
    });

    it('should read powerOnsDirectory from the poweron-directory input', () => {
      setActionInputs({ 'poweron-directory': 'CUSTOM/' });

      const config = loadValidateConfig();

      expect(config.powerOnsDirectory).toBe('CUSTOM/');
      expect(config.repoConfig.inputs.powerOnsDirectory).toBe('CUSTOM/');
    });

    // The vendored `mapDeployedToChangedFiles` builds `${directory}${name}`
    // with no separator, so the trailing slash the Azure extension guarantees
    // through its zod config schema has to be restored on the input instead.
    it.each([
      ['no trailing slash', 'REPWRITERSPECS', 'REPWRITERSPECS/'],
      ['one trailing slash', 'REPWRITERSPECS/', 'REPWRITERSPECS/'],
      ['repeated trailing slashes', 'REPWRITERSPECS//', 'REPWRITERSPECS/'],
      ['a multi-segment path', 'SPECS/PO', 'SPECS/PO/'],
      ['a backslash-separated path', 'SPECS\\PO', 'SPECS/PO/'],
      ['surrounding whitespace', '  SPECS/PO  ', 'SPECS/PO/'],
    ])(
      'should normalize a poweron-directory with %s to exactly one trailing slash',
      (_description, input, expected) => {
        setActionInputs({ 'poweron-directory': input });

        const config = loadValidateConfig();

        expect(config.powerOnsDirectory).toBe(expected);
        expect(config.repoConfig.inputs.powerOnsDirectory).toBe(expected);
      },
    );

    it('should build a repo config with the pipelines directory defaults', () => {
      const config = loadValidateConfig();

      expect(config.repoConfig).toEqual({
        inputs: {
          powerOnsDirectory: 'REPWRITERSPECS/',
          letterFilesDirectory: 'LETTERSPECS/',
          dataFilesDirectory: 'DATAFILES/',
          helpFilesDirectory: 'HELPFILES/',
        },
        branchSymNumbers: {},
        installPowerOns: [],
        validateIgnorePowerOns: [],
        preserveServerFiles: [],
      });
    });

    it('should use the default SSH port when ssh-port is not provided', () => {
      expect(loadValidateConfig().sshPort).toBe(22);
    });

    it('should use the ssh-port input when provided', () => {
      setActionInputs({ 'ssh-port': '2222' });

      expect(loadValidateConfig().sshPort).toBe(2222);
    });

    it('should throw InputError for an invalid hostname', () => {
      setActionInputs({ 'symitar-hostname': 'invalid hostname!' });

      expect(() => loadValidateConfig()).toThrow(InputError);
    });

    it('should throw InputError for an out-of-range ssh port', () => {
      setActionInputs({ 'ssh-port': '99999' });

      expect(() => loadValidateConfig()).toThrow(InputError);
    });

    it('should enable debug when the debug input is true', () => {
      setActionInputs({ debug: 'true' });

      expect(loadValidateConfig().debug).toBe(true);
    });

    it('should default debug to false when the input is unset', () => {
      delete process.env.INPUT_DEBUG;

      expect(loadValidateConfig().debug).toBe(false);
    });

    describe('symNumber', () => {
      it('should resolve symNumber as a number', () => {
        const config = loadValidateConfig();

        expect(config.symNumber).toBe(627);
        expect(typeof config.symNumber).toBe('number');
      });

      it('should not zero-pad a single digit sym number', () => {
        setActionInputs({ 'sym-number': '7' });

        const config = loadValidateConfig();

        expect(config.symNumber).toBe(7);
        expect(typeof config.symNumber).toBe('number');
      });

      it('should normalize a zero-padded input to a number', () => {
        setActionInputs({ 'sym-number': '007' });

        expect(loadValidateConfig().symNumber).toBe(7);
      });

      it('should throw SymNumberError for a non-numeric sym number', () => {
        setActionInputs({ 'sym-number': 'abc' });

        expect(() => loadValidateConfig()).toThrow(SymNumberError);
      });

      it('should throw SymNumberError when sym-number is empty', () => {
        setActionInputs({ 'sym-number': '' });

        expect(() => loadValidateConfig()).toThrow(SymNumberError);
      });

      // `isValidNumber` is only a typeof/NaN check, so every value below
      // reached SymitarSSH/SymitarHTTPs as the sym to validate against.
      // synchronize-symitar-action bounds this identically.
      it.each([
        ['a negative sym', '-627'],
        ['a fractional sym', '627.5'],
        ['exponent notation above the range', '1e6'],
        ['just above the range', '1000'],
        ['Infinity', 'Infinity'],
      ])('should throw SymNumberError for %s', (_name, symNumber) => {
        setActionInputs({ 'sym-number': symNumber });

        expect(() => loadValidateConfig()).toThrow(SymNumberError);
      });

      it.each([
        ['the bottom of the range', '0', 0],
        ['a single digit', '7', 7],
        ['the top of the range', '999', 999],
      ])('should accept %s', (_name, input, expected) => {
        setActionInputs({ 'sym-number': input });

        expect(loadValidateConfig().symNumber).toBe(expected);
      });
    });

    describe('list inputs', () => {
      const parsedList = (inputName: string): string[] => {
        const config = loadValidateConfig();
        return {
          'validate-ignore': config.validateIgnore,
          'preserve-server-files': config.preserveServerFiles,
        }[inputName]!;
      };

      it('should parse a comma-delimited validate-ignore input', () => {
        setActionInputs({ 'validate-ignore': 'IGNORE.PO, OTHER.PO' });

        expect(loadValidateConfig().validateIgnore).toEqual([
          'IGNORE.PO',
          'OTHER.PO',
        ]);
      });

      it('should parse a comma-delimited preserve-server-files input', () => {
        setActionInputs({ 'preserve-server-files': 'RD.*, PFR.*' });

        expect(loadValidateConfig().preserveServerFiles).toEqual([
          'RD.*',
          'PFR.*',
        ]);
      });

      it('should default validate-ignore to an empty list', () => {
        expect(loadValidateConfig().validateIgnore).toEqual([]);
      });

      // Not comma-only. `action.yml` inputs are plain strings, this README has
      // documented the multi-line and YAML block-sequence forms since v1, and
      // narrowing it would not error - it would collapse
      // `preserve-server-files: |\n  - RD.*\n  - PFR.*` into one entry that
      // matches nothing, so previously-preserved files would silently start
      // being validated. synchronize-symitar-action parses these identically.
      it.each([['validate-ignore'], ['preserve-server-files']])(
        'should split a newline-delimited %s value',
        (inputName) => {
          setActionInputs({ [inputName]: 'ONE.PO\nTWO.PO' });

          expect(parsedList(inputName)).toEqual(['ONE.PO', 'TWO.PO']);
        },
      );

      it.each([['validate-ignore'], ['preserve-server-files']])(
        'should parse a YAML block sequence in %s',
        (inputName) => {
          setActionInputs({ [inputName]: '- ONE.PO\n- TWO.PO\n' });

          expect(parsedList(inputName)).toEqual(['ONE.PO', 'TWO.PO']);
        },
      );

      it.each([['validate-ignore'], ['preserve-server-files']])(
        'should accept commas and newlines mixed in %s',
        (inputName) => {
          setActionInputs({ [inputName]: 'ONE.PO, TWO.PO\n- THREE.PO' });

          expect(parsedList(inputName)).toEqual([
            'ONE.PO',
            'TWO.PO',
            'THREE.PO',
          ]);
        },
      );

      it.each([['validate-ignore'], ['preserve-server-files']])(
        'should drop blank entries in %s',
        (inputName) => {
          setActionInputs({ [inputName]: 'ONE.PO,,\n\n  \nTWO.PO' });

          expect(parsedList(inputName)).toEqual(['ONE.PO', 'TWO.PO']);
        },
      );
    });

    describe('syncMethod', () => {
      it('should default to sftp', () => {
        expect(loadValidateConfig().syncMethod).toBe('sftp');
      });

      it('should accept rsync', () => {
        setActionInputs({ 'sync-method': 'rsync' });

        expect(loadValidateConfig().syncMethod).toBe('rsync');
      });

      it('should throw InputError for an invalid sync method', () => {
        setActionInputs({ 'sync-method': 'ftp' });

        expect(() => loadValidateConfig()).toThrow(InputError);
        expect(() => loadValidateConfig()).toThrow(/Must be 'sftp' or 'rsync'/);
      });
    });
    describe('v2.2 connection compatibility', () => {
      it.each(['', 'ssh', 'https', 'HTTPS', 'future-protocol'])(
        'ignores selector %s and any application port',
        (selector) => {
          setActionInputs({
            'connection-type': selector,
            'symitar-app-port': 'not-a-port',
          });
          const config = loadValidateConfig();
          expect(config.symitarAppPort).toBeUndefined();
          expect(config.sshPort).toBe(22);
        },
      );
      it('accepts an approved host key unchanged', () => {
        setActionInputs({ 'ssh-host-key': 'approved-key' });
        expect(loadValidateConfig().sshHostKey).toBe('approved-key');
      });
      it.each([
        'ssh-username',
        'ssh-password',
        'symitar-user-number',
        'symitar-user-password',
      ])('rejects blank %s before connecting', (name) => {
        setActionInputs({ [name]: '   ' });
        expect(() => loadValidateConfig()).toThrow(InputError);
      });
    });

    // determineValidationMode returns 'none' unless one of the refs matches
    // /^refs\/heads\/.+$/, and the vendored runner then reports 0/0/0 and
    // exits 0 without ever contacting Symitar.
    describe('validation mode warning', () => {
      it('should warn when neither ref is a branch ref (tag run, no target-branch)', () => {
        process.env.GITHUB_REF = 'refs/tags/v1.0.0';

        loadValidateConfig();

        expect(warningSpy).toHaveBeenCalledTimes(1);
        expect(warningSpy).toHaveBeenCalledWith(
          expect.stringContaining('no PowerOn files will be validated'),
        );
        expect(warningSpy).toHaveBeenCalledWith(
          expect.stringContaining('refs/tags/v1.0.0'),
        );
      });

      it('should warn when GITHUB_REF is unset entirely', () => {
        delete process.env.GITHUB_REF;

        loadValidateConfig();

        expect(warningSpy).toHaveBeenCalledTimes(1);
      });

      it('should not warn on a tag run that supplies a target-branch', () => {
        process.env.GITHUB_REF = 'refs/tags/v1.0.0';
        setActionInputs({ 'target-branch': 'main' });

        loadValidateConfig();

        expect(warningSpy).not.toHaveBeenCalled();
      });

      it('should not warn on a branch ref (hash-comparison mode)', () => {
        loadValidateConfig();

        expect(warningSpy).not.toHaveBeenCalled();
      });
    });

    describe('branch refs', () => {
      it('should take buildBranch from GITHUB_REF unchanged', () => {
        process.env.GITHUB_REF = 'refs/heads/release/1.0';

        const config = loadValidateConfig();

        expect(config.buildBranch).toBe('refs/heads/release/1.0');
        expect(config.buildBranchName).toBe('release/1.0');
      });

      it('should default targetBranch to GITHUB_BASE_REF on a pull_request', () => {
        process.env.GITHUB_EVENT_NAME = 'pull_request';
        process.env.GITHUB_BASE_REF = 'main';

        const config = loadValidateConfig();

        expect(config.targetBranchName).toBe('main');
        expect(config.targetBranch).toBe('refs/heads/main');
      });

      it('should ignore GITHUB_BASE_REF when the event is not a pull_request', () => {
        process.env.GITHUB_EVENT_NAME = 'push';
        process.env.GITHUB_BASE_REF = 'main';

        const config = loadValidateConfig();

        expect(config.targetBranchName).toBe('');
        expect(config.targetBranch).toBe('');
      });

      it('should convert a bare target-branch input to a refs/heads ref', () => {
        setActionInputs({ 'target-branch': 'develop' });

        const config = loadValidateConfig();

        expect(config.targetBranchName).toBe('develop');
        expect(config.targetBranch).toBe('refs/heads/develop');
      });

      it('should let the target-branch input override the pull_request default', () => {
        process.env.GITHUB_EVENT_NAME = 'pull_request';
        process.env.GITHUB_BASE_REF = 'main';
        setActionInputs({ 'target-branch': 'develop' });

        const config = loadValidateConfig();

        expect(config.targetBranchName).toBe('develop');
        expect(config.targetBranch).toBe('refs/heads/develop');
      });

      it('should reject an origin/ prefixed target-branch', () => {
        setActionInputs({ 'target-branch': 'origin/main' });

        expect(() => loadValidateConfig()).toThrow(InputError);
        expect(() => loadValidateConfig()).toThrow(
          /Expected a bare branch name such as 'main'/,
        );
      });

      it('should reject a refs/heads/ prefixed target-branch', () => {
        setActionInputs({ 'target-branch': 'refs/heads/main' });

        expect(() => loadValidateConfig()).toThrow(InputError);
        expect(() => loadValidateConfig()).toThrow(
          /Expected a bare branch name such as 'main'/,
        );
      });

      it('should leave targetBranch empty when nothing is configured', () => {
        const config = loadValidateConfig();

        expect(config.targetBranch).toBe('');
        expect(config.targetBranchName).toBe('');
      });
    });
  });
});
