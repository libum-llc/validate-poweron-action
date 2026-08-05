import * as path from 'path';

import { getSkipReasonForFile } from '@libum-llc/symitar';
import type { SymitarHTTPs, SymitarSSH } from '@libum-llc/symitar';

import type { Logger } from '@lib/logger';
import {
  createHTTPsClient,
  createSSHClient,
  type ValidateTaskConfig,
} from '@lib/task-orchestration';

import {
  resolveLocalPowerOnDirectory,
  resolveLocalPowerOnPath,
  toDeployedFileName,
  validatePowerOnDependencies,
} from './dependencies';
import {
  runValidatePowerOnTask,
  type ValidatePowerOnTaskDependencies,
} from './run';

jest.mock('@libum-llc/symitar', () => ({
  getSkipReasonForFile: jest.fn().mockResolvedValue(null),
}));

jest.mock('@lib/task-orchestration', () => ({
  createHTTPsClient: jest.fn(),
  createSSHClient: jest.fn(),
  loadValidateConfig: jest.fn(),
  validateTaskApiKey: jest.fn().mockResolvedValue(undefined),
  getSyncTransport: jest.fn().mockReturnValue('sftp'),
  DEFAULT_SYNC_COMPARE_MODE: 'quick',
}));

const WORKSPACE = path.join(path.sep, 'home', 'runner', 'work', 'repo', 'repo');

const getSkipReasonForFileMock = getSkipReasonForFile as jest.MockedFunction<
  typeof getSkipReasonForFile
>;
const createHTTPsClientMock = createHTTPsClient as jest.MockedFunction<
  typeof createHTTPsClient
>;
const createSSHClientMock = createSSHClient as jest.MockedFunction<
  typeof createSSHClient
>;

function createConfig(): ValidateTaskConfig {
  return {
    logPrefix: '[Test]',
    buildBranch: 'refs/heads/main',
    buildBranchName: 'main',
    targetBranch: '',
    targetBranchName: '',
    repoConfig: {
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
    },
    apiKey: 'test-api-key',
    powerOnsDirectory: 'REPWRITERSPECS/',
    symitarHostname: 'symitar.test',
    sshUsername: 'test-user',
    sshPassword: 'test-password',
    sshPort: 22,
    symNumber: 627,
    symitarUserNumber: '1999',
    symitarUserPassword: 'test-user-password',
    debug: false,
    validateIgnore: [],
    preserveServerFiles: [],
    syncMethod: 'sftp',
    symitarAppPort: 42627,
  };
}

function createLogger(): Logger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    startTimer: jest.fn(),
    endTimer: jest.fn().mockReturnValue(10),
    logSummary: jest.fn(),
  } as unknown as Logger;
}

/**
 * Wires the real production dependencies (client factories, path
 * normalization and file filtering) around stubbed Symitar clients.
 */
function createHarness(deployed: string[], connectionType: 'https' | 'ssh') {
  const getChangedFiles = jest
    .fn()
    .mockResolvedValue({ deployed, deleted: [] });
  const validatePowerOn = jest
    .fn()
    .mockResolvedValue({ isValid: true, errors: '' });

  const httpsClient = {
    getChangedFiles,
    validatePowerOn,
    end: jest.fn().mockResolvedValue(undefined),
  } as unknown as SymitarHTTPs;
  const sshClient = {
    getChangedFiles,
    createValidateWorker: jest.fn().mockResolvedValue({ validatePowerOn }),
    end: jest.fn().mockResolvedValue(undefined),
  } as unknown as SymitarSSH;

  createHTTPsClientMock.mockReturnValue(httpsClient);
  createSSHClientMock.mockResolvedValue(sshClient);

  const dependencies: ValidatePowerOnTaskDependencies = {
    ...validatePowerOnDependencies,
    task: {
      ...validatePowerOnDependencies.task,
      getInput: jest.fn().mockReturnValue(connectionType),
      setVariable: jest.fn(),
      warning: jest.fn(),
    },
    loadConfig: jest.fn().mockReturnValue(createConfig()),
    validateApiKey: jest.fn().mockResolvedValue(undefined),
    createTaskLogger: jest.fn().mockReturnValue(createLogger()),
    registerCleanup: jest.fn(),
  };

  return { dependencies, getChangedFiles, validatePowerOn };
}

describe('validate dependencies', () => {
  const originalWorkspace = process.env.GITHUB_WORKSPACE;

  beforeEach(() => {
    process.env.GITHUB_WORKSPACE = WORKSPACE;
    getSkipReasonForFileMock.mockResolvedValue(null);
  });

  afterAll(() => {
    if (originalWorkspace === undefined) {
      delete process.env.GITHUB_WORKSPACE;
    } else {
      process.env.GITHUB_WORKSPACE = originalWorkspace;
    }
  });

  describe('resolveLocalPowerOnPath', () => {
    it('resolves a directory-prefixed path against the workspace', () => {
      expect(
        resolveLocalPowerOnPath('REPWRITERSPECS/', 'REPWRITERSPECS/FOO.PO'),
      ).toBe(path.join(WORKSPACE, 'REPWRITERSPECS', 'FOO.PO'));
    });

    it('resolves a bare file name against the local PowerOn directory', () => {
      expect(resolveLocalPowerOnPath('REPWRITERSPECS/', 'FOO.PO')).toBe(
        path.join(WORKSPACE, 'REPWRITERSPECS', 'FOO.PO'),
      );
    });

    it('returns absolute paths untouched', () => {
      const absolute = path.join(WORKSPACE, 'REPWRITERSPECS', 'FOO.PO');

      expect(resolveLocalPowerOnPath('REPWRITERSPECS/', absolute)).toBe(
        absolute,
      );
    });

    it('resolves nested paths below the PowerOn directory', () => {
      expect(resolveLocalPowerOnPath('REPWRITERSPECS/', 'SUB/FOO.PO')).toBe(
        path.join(WORKSPACE, 'REPWRITERSPECS', 'SUB', 'FOO.PO'),
      );
    });

    it('resolves the PowerOn directory itself', () => {
      expect(resolveLocalPowerOnPath('REPWRITERSPECS/', 'REPWRITERSPECS')).toBe(
        resolveLocalPowerOnDirectory('REPWRITERSPECS/'),
      );
    });
  });

  describe('toDeployedFileName', () => {
    it.each([
      ['REPWRITERSPECS/FOO.PO'],
      ['FOO.PO'],
      [path.join(WORKSPACE, 'REPWRITERSPECS', 'FOO.PO')],
    ])('reduces %s to a bare file name', (deployedPath) => {
      expect(toDeployedFileName('REPWRITERSPECS/', deployedPath)).toBe(
        'FOO.PO',
      );
    });

    it('falls back to the base name for paths outside the directory', () => {
      expect(
        toDeployedFileName(
          'REPWRITERSPECS/',
          path.join(path.sep, 'tmp', 'FOO.PO'),
        ),
      ).toBe('FOO.PO');
    });
  });

  describe.each([['https'], ['ssh']] as const)(
    'changed file paths over %s',
    (connectionType) => {
      it.each([
        ['already prefixed', 'REPWRITERSPECS/FOO.PO'],
        ['bare', 'FOO.PO'],
      ])(
        'validates a %s changed file exactly once, without double-prefixing',
        async (_shape, deployedPath) => {
          const { dependencies, validatePowerOn } = createHarness(
            [deployedPath],
            connectionType,
          );

          await expect(runValidatePowerOnTask(dependencies)).resolves.toBe(
            'Successfully validated all changed PowerOns',
          );

          expect(validatePowerOn).toHaveBeenCalledWith(
            'REPWRITERSPECS/FOO.PO',
            { localIncludeDir: 'REPWRITERSPECS/' },
          );
          expect(getSkipReasonForFileMock).toHaveBeenCalledWith(
            path.join(WORKSPACE, 'REPWRITERSPECS', 'FOO.PO'),
          );
        },
      );
    },
  );

  it('publishes kebab-case outputs through the task shim', async () => {
    const { dependencies } = createHarness(['REPWRITERSPECS/FOO.PO'], 'https');

    await runValidatePowerOnTask(dependencies);

    expect(dependencies.task.setVariable).toHaveBeenCalledWith(
      'filesValidated',
      '1',
      false,
      true,
    );
  });

  it('skips a file whose stat fails only when symitar says so', async () => {
    getSkipReasonForFileMock.mockResolvedValue('not a PowerOn file');
    const { dependencies, validatePowerOn } = createHarness(
      ['REPWRITERSPECS/FOO.PO'],
      'https',
    );

    await expect(runValidatePowerOnTask(dependencies)).resolves.toBe(
      'No changed PowerOn files found',
    );
    expect(validatePowerOn).not.toHaveBeenCalled();
  });
});
