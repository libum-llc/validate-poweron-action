import * as core from '@actions/core';

import {
  runValidatePowerOnTask,
  ConfigError,
  AuthenticationError,
  ConnectionError,
  InputError,
  SymNumberError,
  ValidationError,
} from '@libum-llc/pipelines-core';

import { run } from '../src/main';
import { validatePowerOnDependencies } from '../src/validate/dependencies';
import { version } from '../package.json';

jest.mock('@actions/core');

// Only the task runner is stubbed. The error classes are the real ones from
// `@libum-llc/pipelines-core`, because every assertion below turns on
// `main.ts`'s `instanceof` dispatch - replacing them with fakes would make the
// whole error-mapping suite vacuous.
jest.mock('@libum-llc/pipelines-core', () => ({
  ...jest.requireActual('@libum-llc/pipelines-core'),
  runValidatePowerOnTask: jest.fn(),
}));

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
const mockDebug = core.debug as jest.MockedFunction<typeof core.debug>;
const mockWarning = core.warning as jest.MockedFunction<typeof core.warning>;
const mockNotice = core.notice as jest.MockedFunction<typeof core.notice>;

/**
 * Every `@actions/core` channel that puts text in front of a human.
 *
 * `setFailed` matters most and is the easiest to forget: it is the single most
 * prominent piece of text in the job UI, and `main.ts` interpolates error
 * content into it on every branch. A leak assertion that only inspects
 * `info` + `error` would pass while the key sat in the failure annotation.
 * `debug` is included because GitHub archives step-debug logs the same way it
 * archives everything else - a secret written there is still a secret written
 * to a public repository's logs.
 */
const LOG_CHANNELS = [
  mockInfo,
  mockError,
  mockSetFailed,
  mockDebug,
  mockWarning,
  mockNotice,
];

/**
 * Everything `main.ts` handed to any of those channels, as one blob.
 */
const allLoggedText = (): string =>
  LOG_CHANNELS.flatMap((channel) => channel.mock.calls.flat())
    .map((argument) =>
      argument instanceof Error ? argument.stack || argument.message : argument,
    )
    .join('\n');

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

      // Every setSecret call must precede every call to *any* log channel -
      // not just info/error - using jest's global invocation-order counter.
      const lastSetSecretOrder = Math.max(
        ...mockSetSecret.mock.invocationCallOrder,
      );
      const logOrders = LOG_CHANNELS.flatMap(
        (channel) => channel.mock.invocationCallOrder,
      );
      expect(logOrders.every((order) => order > lastSetSecretOrder)).toBe(true);
    });

    it('logs the startup banner with the package version', async () => {
      mockRunValidatePowerOnTask.mockResolvedValue('Successfully validated');

      await run();

      expect(mockInfo).toHaveBeenCalledWith(
        expect.stringContaining(`v${version}`),
      );
    });

    it('does not register an empty mask for an absent secret input', async () => {
      mockGetInput.mockImplementation((name: string) =>
        name === 'ssh-password' ? '' : (INPUT_VALUES[name] ?? ''),
      );
      mockRunValidatePowerOnTask.mockResolvedValue('Successfully validated');

      await run();

      expect(mockSetSecret).not.toHaveBeenCalledWith('');
      expect(mockSetSecret).toHaveBeenCalledTimes(2);
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
      // Neither the full API key nor any substring of it may be logged, on
      // any channel.
      expect(allLoggedText()).not.toContain('sk-abcdefghijklmnop');
    });

    it('never logs any portion of the API key on any channel, including the pre-truncated prefix returned by AuthenticationError', async () => {
      // Regression test: `AuthenticationError.apiKeyPrefix` is the first 8
      // characters of the raw key plus '...'. `core.setSecret()` only masks
      // the *full* secret string, so logging `apiKeyPrefix` directly leaks
      // real key material into CI logs on public repos. This must never
      // appear anywhere main.ts logs - and "anywhere" has to include
      // `setFailed`, which is where main.ts interpolates the most error
      // content and which the job UI renders most prominently.
      const apiKey = 'sk-abcdefghijklmnop';
      const error = new AuthenticationError(
        'No active subscription found',
        apiKey,
        'symitar.example.com',
      );
      // Sanity-check the fixture actually exercises the leak this test guards
      // against - if core's class ever stops truncating, this fails loudly.
      expect(error.apiKeyPrefix).toBe('sk-abcde...');

      mockRunValidatePowerOnTask.mockRejectedValue(error);

      await run();

      const logged = allLoggedText();

      // Guard against a vacuous pass: main.ts must actually have logged
      // something on the channels being searched.
      expect(logged).toContain('No active subscription found');

      expect(logged).not.toContain(apiKey);
      expect(logged).not.toContain(error.apiKeyPrefix);
      // The prefix without its trailing '...' is the actual leaked key material.
      expect(logged).not.toContain(error.apiKeyPrefix!.replace(/\.\.\.$/, ''));
    });

    it('keeps the API key out of every channel when it is embedded in the error message itself', async () => {
      // The `setFailed` message is built from `error.message`. If a caller
      // ever puts key material in the message, that is a separate bug - but
      // this test documents which channels are searched, so an added channel
      // in main.ts is caught by the LOG_CHANNELS list rather than silently
      // going uninspected.
      const error = new AuthenticationError(
        'No active subscription found',
        'sk-abcdefghijklmnop',
        'symitar.example.com',
      );
      mockRunValidatePowerOnTask.mockRejectedValue(error);

      await run();

      expect(mockSetFailed.mock.calls.flat().join('\n')).not.toContain(
        'sk-abcde',
      );
      expect(mockDebug.mock.calls.flat().join('\n')).not.toContain('sk-abcde');
      expect(mockWarning.mock.calls.flat().join('\n')).not.toContain(
        'sk-abcde',
      );
      expect(mockNotice.mock.calls.flat().join('\n')).not.toContain('sk-abcde');
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

describe('resolveExitCode', () => {
  // Guards the fix for a live-observed hang: the action logged success and
  // then sat on the runner for 14 minutes until the job timeout killed it,
  // because a lingering Symitar client handle kept Node's event loop alive.
  // The entry point now force-exits, and must carry core.setFailed's exit
  // code through rather than always reporting success.
  it('defaults to 0 when nothing set an exit code', () => {
    const { resolveExitCode } = require('../src/main');
    expect(resolveExitCode(undefined)).toBe(0);
  });

  it('preserves a failure code set by core.setFailed', () => {
    const { resolveExitCode } = require('../src/main');
    expect(resolveExitCode(1)).toBe(1);
  });

  it('treats a non-numeric exit code as success', () => {
    const { resolveExitCode } = require('../src/main');
    expect(resolveExitCode('oops' as unknown as number)).toBe(0);
  });
});
