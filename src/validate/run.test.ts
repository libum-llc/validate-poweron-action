import type * as tl from 'azure-pipelines-task-lib/task';
import type { SymitarHTTPs } from '@libum-llc/symitar';

import { ValidationError } from '@lib/errors';
import type { Logger } from '@lib/logger';
import type { ValidateTaskConfig } from '@lib/task-orchestration';
import {
  runValidatePowerOnTask,
  type ValidatePowerOnTaskDependencies,
} from './run';

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
      branchSymNumbers: { main: 627 },
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

function createLogger(): jest.Mocked<Logger> {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    startTimer: jest.fn(),
    endTimer: jest.fn().mockReturnValue(25),
    getMetrics: jest.fn(),
    incrementProcessed: jest.fn(),
    incrementErrors: jest.fn(),
    logSummary: jest.fn(),
    logProgress: jest.fn(),
  } as unknown as jest.Mocked<Logger>;
}

function createHarness(options?: {
  deployed?: string[];
  validation?: { isValid: boolean; errors: string | string[] };
  validationError?: Error;
}) {
  const task = {
    getInput: jest.fn().mockReturnValue('https'),
    setVariable: jest.fn(),
    warning: jest.fn(),
  } as unknown as jest.Mocked<typeof tl>;
  const logger = createLogger();
  const client = {
    getChangedFiles: jest.fn().mockResolvedValue({
      deployed: options?.deployed ?? ['VALID.PO'],
      deleted: [],
    }),
    validatePowerOn: options?.validationError
      ? jest.fn().mockRejectedValue(options.validationError)
      : jest
          .fn()
          .mockResolvedValue(
            options?.validation ?? { isValid: true, errors: '' },
          ),
    end: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<SymitarHTTPs>;

  const dependencies: ValidatePowerOnTaskDependencies = {
    task: task as unknown as typeof tl,
    loadConfig: jest.fn().mockReturnValue(createConfig()),
    validateApiKey: jest.fn().mockResolvedValue(undefined),
    createHttpsClient: jest.fn().mockReturnValue(client),
    createSshClient: jest.fn(),
    getGitChangedFiles: jest.fn(),
    createTaskLogger: jest.fn().mockReturnValue(logger),
    filterChangedFiles: jest.fn(async (files) => ({
      filesToValidate: files,
      skippedFiles: [],
    })),
    registerCleanup: jest.fn(),
  };

  return { client, dependencies, logger, task };
}

describe('runValidatePowerOnTask', () => {
  it('validates changed files and publishes successful statistics', async () => {
    const { client, dependencies, logger, task } = createHarness();

    await expect(runValidatePowerOnTask(dependencies)).resolves.toBe(
      'Successfully validated all changed PowerOns',
    );

    expect(client.validatePowerOn).toHaveBeenCalledWith(
      'REPWRITERSPECS/VALID.PO',
      { localIncludeDir: 'REPWRITERSPECS/' },
    );
    expect(task.setVariable).toHaveBeenCalledWith(
      'filesValidated',
      '1',
      false,
      true,
    );
    expect(task.setVariable).toHaveBeenCalledWith(
      'filesPassed',
      '1',
      false,
      true,
    );
    expect(task.setVariable).toHaveBeenCalledWith(
      'filesFailed',
      '0',
      false,
      true,
    );
    expect(logger.logSummary).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'success', filesProcessed: 1 }),
    );
  });

  it('uses Symitar hash comparison for non-PR builds and validates only changed files', async () => {
    const { client, dependencies } = createHarness({
      deployed: ['CHANGED_UNDERSCORE.PO'],
    });

    await runValidatePowerOnTask(dependencies);

    expect(dependencies.getGitChangedFiles).not.toHaveBeenCalled();
    expect(client.getChangedFiles).toHaveBeenCalledWith(
      'REPWRITERSPECS/',
      undefined,
      undefined,
      expect.objectContaining({ compareMode: 'quick' }),
    );
    expect(client.validatePowerOn).toHaveBeenCalledTimes(1);
    expect(client.validatePowerOn).toHaveBeenCalledWith(
      'REPWRITERSPECS/CHANGED_UNDERSCORE.PO',
      { localIncludeDir: 'REPWRITERSPECS/' },
    );
  });

  it('returns success with zero statistics when nothing changed', async () => {
    const { client, dependencies, task } = createHarness({ deployed: [] });

    await expect(runValidatePowerOnTask(dependencies)).resolves.toBe(
      'No changed PowerOn files found',
    );

    expect(client.validatePowerOn).not.toHaveBeenCalled();
    expect(task.setVariable).toHaveBeenCalledWith(
      'filesValidated',
      '0',
      false,
      true,
    );
    expect(task.setVariable).toHaveBeenCalledWith(
      'filesPassed',
      '0',
      false,
      true,
    );
    expect(task.setVariable).toHaveBeenCalledWith(
      'filesFailed',
      '0',
      false,
      true,
    );
  });

  it('throws ValidationError and publishes failed statistics', async () => {
    const { dependencies, logger, task } = createHarness({
      validation: { isValid: false, errors: 'Syntax error' },
    });

    await expect(runValidatePowerOnTask(dependencies)).rejects.toMatchObject({
      constructor: ValidationError,
      message: 'Found 1 invalid PowerOn',
    });

    expect(task.setVariable).toHaveBeenCalledWith(
      'filesFailed',
      '1',
      false,
      true,
    );
    expect(logger.logSummary).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failure', filesFailed: 1 }),
    );
  });

  it('propagates operational validation failures without reporting success', async () => {
    const operationalError = new Error('Permission denied');
    const { dependencies, logger, task } = createHarness({
      validationError: operationalError,
    });

    await expect(runValidatePowerOnTask(dependencies)).rejects.toBe(
      operationalError,
    );

    expect(task.setVariable).not.toHaveBeenCalled();
    expect(logger.logSummary).not.toHaveBeenCalled();
  });
});
