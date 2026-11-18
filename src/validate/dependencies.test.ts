import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getSkipReasonForFile } from '@libum-llc/symitar';
import {
  createQuestClient,
  runValidatePowerOnTask,
  type PipelineClient,
  type Logger,
  type ValidatePowerOnConfig,
  type ValidatePowerOnTaskDependencies,
} from '@libum-llc/pipelines-core';
import { validatePowerOnDependencies } from './dependencies';

// Real core runner/filter and GitHub host. Only host-side PowerOn inspection
// and the live connection are stubbed; no test contacts a Symitar console.
jest.mock('@libum-llc/symitar', () => ({
  ...jest.requireActual('@libum-llc/symitar'),
  getSkipReasonForFile: jest.fn().mockResolvedValue(null),
}));
const getSkipReasonForFileMock = jest.mocked(getSkipReasonForFile);
function createConfig(
  overrides: Partial<ValidatePowerOnConfig> = {},
): ValidatePowerOnConfig {
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
    workspacePath: process.env.GITHUB_WORKSPACE,
    ...overrides,
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

function createHarness(
  deployed: string[],
  overrides: Partial<ValidatePowerOnConfig> = {},
) {
  const getChangedFiles = jest
    .fn()
    .mockResolvedValue({ deployed, deleted: [] });
  const validatePowerOn = jest
    .fn()
    .mockResolvedValue({ isValid: true, errors: '' });
  const end = jest.fn().mockResolvedValue(undefined);
  const connect = jest.fn().mockResolvedValue({
    getChangedFiles,
    validatePowerOn,
    end,
  } as unknown as PipelineClient);
  const getGitChangedFiles = jest.fn().mockReturnValue([]);
  const dependencies: ValidatePowerOnTaskDependencies = {
    ...validatePowerOnDependencies,
    task: {
      ...validatePowerOnDependencies.task,
      getInput: jest.fn(() => {
        throw new Error('Legacy inputs must not be read');
      }),
      setOutput: jest.fn(),
      warning: jest.fn(),
    },
    loadConfig: () => createConfig(overrides),
    validateApiKey: jest.fn().mockResolvedValue(undefined),
    createQuestClient: connect,
    createTaskLogger: () => createLogger(),
    getGitChangedFiles,
    registerCleanup: jest.fn(),
  };
  return {
    dependencies,
    connect,
    getChangedFiles,
    validatePowerOn,
    end,
    getGitChangedFiles,
  };
}

describe('validation adapter with the real shared core', () => {
  const originalEnv = { ...process.env };
  let workspace: string;
  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-adapter-'));
    process.env.GITHUB_WORKSPACE = workspace;
    getSkipReasonForFileMock.mockResolvedValue(null);
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('wires only the shared Symitar connector', () => {
    expect(validatePowerOnDependencies.createQuestClient).toBe(
      createQuestClient,
    );
    expect(validatePowerOnDependencies.createHttpsClient).toBeUndefined();
    expect(validatePowerOnDependencies.createSshClient).toBeUndefined();
  });

  it.each(['FOO.PO', 'REPWRITERSPECS/FOO.PO', 'REPWRITERSPECS\\FOO.PO'])(
    'validates %s once at the workspace with no double prefix',
    async (file) => {
      const h = createHarness([file]);
      await expect(runValidatePowerOnTask(h.dependencies)).resolves.toBe(
        'Successfully validated all changed PowerOns',
      );
      const expected = path.join(workspace, 'REPWRITERSPECS', 'FOO.PO');
      expect(h.validatePowerOn).toHaveBeenCalledTimes(1);
      expect(h.validatePowerOn).toHaveBeenCalledWith(expected, {
        localIncludeDir: path.join(workspace, 'REPWRITERSPECS'),
      });
      expect(getSkipReasonForFileMock).toHaveBeenCalledWith(expected);
      expect(h.connect).toHaveBeenCalledTimes(1);
      expect(h.end).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps an absolute path unchanged', async () => {
    const file = path.join(workspace, 'REPWRITERSPECS', 'FOO.PO');
    const h = createHarness([file]);
    await runValidatePowerOnTask(h.dependencies);
    expect(h.validatePowerOn).toHaveBeenCalledWith(file, expect.any(Object));
  });

  it('uses git changes for PR validation and skips deleted, ignored and preserved files', async () => {
    const h = createHarness([], {
      targetBranch: 'refs/heads/main',
      targetBranchName: 'main',
      validateIgnore: ['IGNORE.PO'],
      preserveServerFiles: ['CUSTOM.*'],
    });
    h.getGitChangedFiles.mockReturnValue([
      { filePath: 'REPWRITERSPECS/FOO.PO', status: 'modified' },
      { filePath: 'REPWRITERSPECS/DELETED.PO', status: 'deleted' },
      { filePath: 'REPWRITERSPECS/IGNORE.PO', status: 'modified' },
      { filePath: 'REPWRITERSPECS/CUSTOM.PO', status: 'modified' },
    ]);
    await runValidatePowerOnTask(h.dependencies);
    expect(h.getChangedFiles).not.toHaveBeenCalled();
    expect(h.getGitChangedFiles).toHaveBeenCalledWith(
      'refs/heads/main',
      'REPWRITERSPECS/',
    );
    expect(h.validatePowerOn).toHaveBeenCalledTimes(1);
    expect(h.validatePowerOn).toHaveBeenCalledWith(
      path.join(workspace, 'REPWRITERSPECS', 'FOO.PO'),
      expect.any(Object),
    );
  });

  it('scans the workspace directory using checksum comparison outside PRs', async () => {
    const h = createHarness(['FOO.PO']);
    await runValidatePowerOnTask(h.dependencies);
    expect(h.getChangedFiles).toHaveBeenCalledWith(
      path.join(workspace, 'REPWRITERSPECS'),
      undefined,
      undefined,
      expect.objectContaining({ compareMode: 'checksum' }),
    );
  });

  it('skips files rejected by PowerOn inspection and publishes zero counts', async () => {
    getSkipReasonForFileMock.mockResolvedValue('not a PowerOn file');
    const h = createHarness(['FOO.PO']);
    await expect(runValidatePowerOnTask(h.dependencies)).resolves.toBe(
      'No changed PowerOn files found',
    );
    expect(h.validatePowerOn).not.toHaveBeenCalled();
    expect(h.dependencies.task.setOutput).toHaveBeenCalledWith(
      'filesValidated',
      '0',
    );
    expect(h.end).toHaveBeenCalledTimes(1);
  });

  it('reports invalid files, fails and closes the connection', async () => {
    const h = createHarness(['FOO.PO']);
    h.validatePowerOn.mockResolvedValue({
      isValid: false,
      errors: 'syntax error',
    });
    await expect(runValidatePowerOnTask(h.dependencies)).rejects.toThrow(
      'invalid PowerOn',
    );
    expect(h.dependencies.task.setOutput).toHaveBeenCalledWith(
      'filesFailed',
      '1',
    );
    expect(h.end).toHaveBeenCalledTimes(1);
  });

  it('does not reconnect after a host failure and awaits cleanup', async () => {
    const h = createHarness(['FOO.PO']);
    h.getChangedFiles.mockRejectedValue(new Error('host failure'));
    await expect(runValidatePowerOnTask(h.dependencies)).rejects.toThrow(
      'host failure',
    );
    expect(h.connect).toHaveBeenCalledTimes(1);
    expect(h.end).toHaveBeenCalledTimes(1);
  });

  it('does not connect when licensing fails', async () => {
    const h = createHarness(['FOO.PO']);
    h.dependencies.validateApiKey = jest
      .fn()
      .mockRejectedValue(new Error('license failure'));
    await expect(runValidatePowerOnTask(h.dependencies)).rejects.toThrow(
      'license failure',
    );
    expect(h.connect).not.toHaveBeenCalled();
  });

  it('publishes real step outputs rather than environment variables', async () => {
    const output = path.join(workspace, 'output');
    const env = path.join(workspace, 'env');
    fs.writeFileSync(output, '');
    fs.writeFileSync(env, '');
    process.env.GITHUB_OUTPUT = output;
    process.env.GITHUB_ENV = env;
    const h = createHarness(['FOO.PO']);
    await runValidatePowerOnTask({
      ...h.dependencies,
      task: validatePowerOnDependencies.task,
    });
    const text = fs.readFileSync(output, 'utf8');
    expect(text).toMatch(/^files-validated<<[\s\S]*?^1$/m);
    expect(text).toMatch(/^files-passed<<[\s\S]*?^1$/m);
    expect(text).toMatch(/^files-failed<<[\s\S]*?^0$/m);
    expect(text).not.toContain('filesValidated');
    expect(fs.readFileSync(env, 'utf8')).toBe('');
  });
});
