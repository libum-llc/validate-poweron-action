import * as core from '@actions/core';

import { run } from '../src/main';
import { runValidatePowerOnTask } from '../src/validate/run';
import { validatePowerOnDependencies } from '../src/validate/dependencies';
import {
  ConfigError,
  AuthenticationError,
  ConnectionError,
  InputError,
  SymNumberError,
  ValidationError,
} from '../src/lib/errors';
import { version } from '../package.json';

jest.mock('@actions/core');
jest.mock('../src/validate/run');

// `main.ts` must receive this exact object, not the bare `runValidatePowerOnTask()`
// pipelines fallback. Mocking the module to a distinctive marker lets the
// "dependencies passed" assertion below catch a regression to the bare call -
// a plain deep-equality check against the real object would not.
jest.mock('../src/validate/dependencies', () => ({
  validatePowerOnDependencies: { __brand: 'validatePowerOnDependencies' },
}));

const mockRunValidatePowerOnTask =
  runValidatePowerOnTask as jest.MockedFunction<typeof runValidatePowerOnTask>;
const mockGetInput = core.getInput as jest.MockedFunction<typeof core.getInput>;
const mockSetSecret = core.setSecret as jest.MockedFunction<
  typeof core.setSecret
>;
const mockSetFailed = core.setFailed as jest.MockedFunction<
  typeof core.setFailed
>;
const mockInfo = core.info as jest.MockedFunction<typeof core.info>;
const mockError = core.error as jest.MockedFunction<typeof core.error>;

const INPUT_VALUES: Record<string, string> = {
  'api-key': 'test-api-key-1234567890',
  'symitar-user-password': 'test-symitar-user-password',
  'ssh-password': 'test-ssh-password',
};

describe('main', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetInput.mockImplementation((name: string) => INPUT_VALUES[name] ?? '');
  });

  describe('secret masking', () => {
    it('masks api-key, symitar-user-password, and ssh-password before any logging', async () => {
      mockRunValidatePowerOnTask.mockResolvedValue('Successfully validated');

      await run();

      expect(mockSetSecret).toHaveBeenCalledWith(INPUT_VALUES['api-key']);
      expect(mockSetSecret).toHaveBeenCalledWith(
        INPUT_VALUES['symitar-user-password'],
      );
      expect(mockSetSecret).toHaveBeenCalledWith(INPUT_VALUES['ssh-password']);
      expect(mockSetSecret).toHaveBeenCalledTimes(3);

      // Every setSecret call must precede every log call (info/error), using
      // jest's global invocation-order counter.
      const lastSetSecretOrder = Math.max(
        ...mockSetSecret.mock.invocationCallOrder,
      );
      const logOrders = [
        ...mockInfo.mock.invocationCallOrder,
        ...mockError.mock.invocationCallOrder,
      ];
      expect(logOrders.every((order) => order > lastSetSecretOrder)).toBe(true);
    });

    it('logs the startup banner with the package version', async () => {
      mockRunValidatePowerOnTask.mockResolvedValue('Successfully validated');

      await run();

      expect(mockInfo).toHaveBeenCalledWith(
        expect.stringContaining(`v${version}`),
      );
    });
  });

  describe('dependencies wiring', () => {
    it('passes validatePowerOnDependencies to runValidatePowerOnTask, not a bare call', async () => {
      mockRunValidatePowerOnTask.mockResolvedValue('Successfully validated');

      await run();

      expect(mockRunValidatePowerOnTask).toHaveBeenCalledTimes(1);
      expect(mockRunValidatePowerOnTask.mock.calls[0][0]).toBe(
        validatePowerOnDependencies,
      );
    });
  });

  describe('success path', () => {
    it('does not call setFailed and logs the result message', async () => {
      mockRunValidatePowerOnTask.mockResolvedValue(
        'Successfully validated all changed PowerOns',
      );

      await run();

      expect(mockSetFailed).not.toHaveBeenCalled();
      expect(mockInfo).toHaveBeenCalledWith(
        expect.stringContaining('Successfully validated all changed PowerOns'),
      );
    });
  });

  describe('error mapping', () => {
    it('maps AuthenticationError to a masked, host-qualified failure', async () => {
      const error = new AuthenticationError(
        'No active subscription found',
        'sk-abcdefghijklmnop',
        'symitar.example.com',
      );
      mockRunValidatePowerOnTask.mockRejectedValue(error);

      await run();

      expect(mockSetFailed).toHaveBeenCalledWith(
        'API key validation failed: No active subscription found',
      );
      expect(mockError).toHaveBeenCalledWith(
        expect.stringContaining('symitar.example.com'),
      );
      // The full API key must never be logged - only the pre-truncated prefix.
      expect(mockError.mock.calls.flat().join('\n')).not.toContain(
        'sk-abcdefghijklmnop',
      );
    });

    it('maps ConnectionError to a host:port-qualified failure', async () => {
      const originalError = new Error('ECONNREFUSED');
      const error = new ConnectionError(
        'Connection timeout after retries',
        'license.libum.io',
        443,
        true,
        originalError,
      );
      mockRunValidatePowerOnTask.mockRejectedValue(error);

      await run();

      expect(mockSetFailed).toHaveBeenCalledWith(
        'Failed to connect to license server: Connection timeout after retries',
      );
      expect(mockError).toHaveBeenCalledWith(
        expect.stringContaining('license.libum.io:443'),
      );
    });

    it('maps InputError to a setFailed using the error message', async () => {
      const error = new InputError(
        "Invalid target-branch: 'origin/main'. Expected a bare branch name.",
        'targetBranch',
      );
      mockRunValidatePowerOnTask.mockRejectedValue(error);

      await run();

      expect(mockSetFailed).toHaveBeenCalledWith(error.message);
      expect(mockError).toHaveBeenCalledWith(
        expect.stringContaining('targetBranch'),
      );
    });

    it('maps SymNumberError to a setFailed using the error message', async () => {
      const error = new SymNumberError(
        'No valid symNumber found for build branch (main)',
        'main',
      );
      mockRunValidatePowerOnTask.mockRejectedValue(error);

      await run();

      expect(mockSetFailed).toHaveBeenCalledWith(error.message);
    });

    it('maps ValidationError to per-file error annotations and a plain setFailed message (not Azure-formatted)', async () => {
      const error = new ValidationError('Found 2 invalid PowerOns', [
        { name: 'FILE1.PO', errors: 'Line 1: Syntax error' },
        { name: 'FILE2.PO', errors: 'Missing variable' },
      ]);
      mockRunValidatePowerOnTask.mockRejectedValue(error);

      await run();

      expect(mockSetFailed).toHaveBeenCalledWith('Found 2 invalid PowerOns');
      const allErrorLines = mockError.mock.calls.flat().join('\n');
      expect(allErrorLines).toContain('FILE1.PO');
      expect(allErrorLines).toContain('Line 1: Syntax error');
      expect(allErrorLines).toContain('FILE2.PO');
      expect(allErrorLines).toContain('Missing variable');
      // Must not use Azure Pipelines' ##[error] log command formatting.
      expect(allErrorLines).not.toContain('##[error]');
    });

    it('maps a generic PowerOnError subclass to setFailed using the error message', async () => {
      const error = new ConfigError('Config failed to load', {
        file: 'config.yml',
      });
      mockRunValidatePowerOnTask.mockRejectedValue(error);

      await run();

      expect(mockSetFailed).toHaveBeenCalledWith('Config failed to load');
    });

    it('maps a plain Error to setFailed using the error message', async () => {
      const error = new Error('Unexpected failure');
      mockRunValidatePowerOnTask.mockRejectedValue(error);

      await run();

      expect(mockSetFailed).toHaveBeenCalledWith('Unexpected failure');
    });

    it('maps a non-Error throw to setFailed using its string representation', async () => {
      mockRunValidatePowerOnTask.mockRejectedValue('a raw string failure');

      await run();

      expect(mockSetFailed).toHaveBeenCalledWith('a raw string failure');
    });
  });
});
