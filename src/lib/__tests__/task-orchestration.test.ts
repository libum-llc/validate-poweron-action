import * as core from '@actions/core';

import { SymitarHTTPs, SymitarSSH } from '@libum-llc/symitar';

import {
  InputError,
  SymNumberError,
  type ValidatePowerOnConfig,
} from '@libum-llc/pipelines-core';

import {
  createHTTPsClient,
  createSSHClient,
  loadValidateConfig,
} from '../task-orchestration';

// Only the Symitar client constructors are stubbed, and the factory spreads
// `requireActual` rather than replacing the module wholesale: this module's
// other imports from `@libum-llc/symitar` - and core's, since core imports it
// too - must keep resolving. `@libum-llc/pipelines-core` is not mocked at all;
// the module under test uses its real error hierarchy and constants, which is
// what the assertions below are written against.
jest.mock('@libum-llc/symitar', () => ({
  ...jest.requireActual('@libum-llc/symitar'),
  SymitarHTTPs: jest.fn(),
  SymitarSSH: jest
    .fn()
    .mockImplementation(() => ({ isReady: Promise.resolve() })),
}));

const symitarSSHMock = SymitarSSH as unknown as jest.Mock;
const symitarHTTPsMock = SymitarHTTPs as unknown as jest.Mock;

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
    });

    describe('list inputs', () => {
      it('should parse a comma-delimited validate-ignore input', () => {
        setActionInputs({ 'validate-ignore': 'IGNORE.PO, OTHER.PO' });

        expect(loadValidateConfig().validateIgnore).toEqual([
          'IGNORE.PO',
          'OTHER.PO',
        ]);
      });

      it('should default validate-ignore to an empty list', () => {
        expect(loadValidateConfig().validateIgnore).toEqual([]);
      });

      it('should NOT split a newline-delimited validate-ignore value', () => {
        setActionInputs({ 'validate-ignore': 'IGNORE.PO\nOTHER.PO' });

        const { validateIgnore } = loadValidateConfig();

        expect(validateIgnore).toHaveLength(1);
        expect(validateIgnore).toEqual(['IGNORE.PO\nOTHER.PO']);
      });

      // The value is still not split - that is breaking change #2 - but the
      // silent-failure half of it is closed: a v1 workflow carrying a
      // multi-line list now says so in the log instead of quietly matching
      // nothing.
      it('should warn when a list input contains a line break', () => {
        setActionInputs({ 'validate-ignore': 'IGNORE.PO\nOTHER.PO' });

        loadValidateConfig();

        expect(warningSpy).toHaveBeenCalledWith(
          expect.stringContaining(
            "'validate-ignore' input contains a line break",
          ),
        );
      });

      it('should name preserve-server-files in its own line-break warning', () => {
        setActionInputs({
          'preserve-server-files': '- RD.*\n- PFR.*',
        });

        loadValidateConfig();

        expect(warningSpy).toHaveBeenCalledWith(
          expect.stringContaining(
            "'preserve-server-files' input contains a line break",
          ),
        );
      });

      it('should not warn for a single-line comma-delimited list', () => {
        setActionInputs({
          'validate-ignore': 'IGNORE.PO, OTHER.PO',
          'preserve-server-files': 'RD.*, PFR.*',
        });

        loadValidateConfig();

        expect(warningSpy).not.toHaveBeenCalled();
      });

      it('should NOT strip a leading "- " YAML list marker', () => {
        setActionInputs({ 'validate-ignore': '- IGNORE.PO, - OTHER.PO' });

        expect(loadValidateConfig().validateIgnore).toEqual([
          '- IGNORE.PO',
          '- OTHER.PO',
        ]);
      });

      it('should parse a comma-delimited preserve-server-files input', () => {
        setActionInputs({ 'preserve-server-files': 'RD.*, PFR.*' });

        expect(loadValidateConfig().preserveServerFiles).toEqual([
          'RD.*',
          'PFR.*',
        ]);
      });

      it('should default preserve-server-files to an empty list', () => {
        expect(loadValidateConfig().preserveServerFiles).toEqual([]);
      });

      it('should NOT split a newline-delimited preserve-server-files value', () => {
        setActionInputs({ 'preserve-server-files': 'RD.*\nPFR.*' });

        expect(loadValidateConfig().preserveServerFiles).toEqual([
          'RD.*\nPFR.*',
        ]);
      });
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

    // `action.yml` cannot express the two-option `pickList` that constrains
    // this input in the Azure extension's `task.json`, and the vendored runner
    // casts it straight to `'https' | 'ssh'` then branches
    // `if (=== 'https') ... else SSH`. Without this validation a typo runs the
    // SSH path silently against an HTTPS-configured job.
    describe('connectionType', () => {
      it('should accept an unset input (action.yml defaults it to https)', () => {
        expect(() => loadValidateConfig()).not.toThrow();
      });

      it.each([['https'], ['ssh']])('should accept %s', (connectionType) => {
        setActionInputs({ 'connection-type': connectionType });

        expect(() => loadValidateConfig()).not.toThrow();
      });

      it('should throw InputError naming the valid values for a typo', () => {
        setActionInputs({ 'connection-type': 'htpps' });

        expect(() => loadValidateConfig()).toThrow(InputError);
        expect(() => loadValidateConfig()).toThrow(
          /Invalid connection type: 'htpps'\. Must be 'https' or 'ssh'/,
        );
      });

      it('should name the connectionType input on the thrown error', () => {
        setActionInputs({ 'connection-type': 'HTTPS' });

        expect(() => loadValidateConfig()).toThrow(
          expect.objectContaining({ inputName: 'connectionType' }),
        );
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

    describe('symitarAppPort', () => {
      it('should parse the symitar-app-port input', () => {
        setActionInputs({ 'symitar-app-port': '42627' });

        expect(loadValidateConfig().symitarAppPort).toBe(42627);
      });

      it('should be undefined when not provided', () => {
        expect(loadValidateConfig().symitarAppPort).toBeUndefined();
      });

      it('should throw InputError for an out-of-range port', () => {
        setActionInputs({ 'symitar-app-port': '99999' });

        expect(() => loadValidateConfig()).toThrow(InputError);
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

  describe('createSSHClient', () => {
    it('should construct a SymitarSSH client from the config', async () => {
      const config = loadValidateConfig();

      await createSSHClient(config);

      expect(symitarSSHMock).toHaveBeenCalledTimes(1);
      expect(symitarSSHMock).toHaveBeenCalledWith(
        {
          host: 'symitar.example.com',
          port: 22,
          username: 'testuser',
          password: 'testpass',
        },
        'info',
      );
    });

    it('should use the debug log level when debug is enabled', async () => {
      setActionInputs({ debug: 'true' });

      await createSSHClient(loadValidateConfig());

      expect(symitarSSHMock).toHaveBeenCalledWith(expect.anything(), 'debug');
    });
  });

  describe('createHTTPsClient', () => {
    const loadHTTPsConfig = (): ValidatePowerOnConfig => {
      setActionInputs({ 'symitar-app-port': '42627' });
      return loadValidateConfig();
    };

    it('should throw InputError when symitarAppPort is missing', () => {
      const config = loadValidateConfig();

      expect(() => createHTTPsClient(config)).toThrow(InputError);
      expect(() => createHTTPsClient(config)).toThrow(
        'symitarAppPort is required when using HTTPS connection',
      );
    });

    it('should let the HTTPS client build its own SSH client from the ssh config', () => {
      const config = loadHTTPsConfig();

      createHTTPsClient(config);

      // The HTTPS client delegates change detection and file transfer to SSH,
      // but constructs that SSH client itself from the `sshConfig` argument -
      // and closes it again on `end()`. Building one here would only duplicate
      // that work, which is why this factory takes no client to share.
      expect(symitarSSHMock).not.toHaveBeenCalled();
      expect(symitarHTTPsMock).toHaveBeenCalledWith(
        'https://symitar.example.com:42627',
        {
          symNumber: 627,
          symitarUserNumber: '1234',
          symitarUserPassword: 'userpass',
        },
        'info',
        { port: 22, username: 'testuser', password: 'testpass' },
      );
    });

    it('should pass the debug log level through to the HTTPS client', () => {
      setActionInputs({ debug: 'true' });
      const config = loadHTTPsConfig();

      createHTTPsClient(config);

      expect(symitarHTTPsMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        'debug',
        expect.any(Object),
      );
    });
  });
});
