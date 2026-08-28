import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { getSkipReasonForFile } from '@libum-llc/symitar';
import type { SymitarHTTPs, SymitarSSH } from '@libum-llc/symitar';

import {
  runValidatePowerOnTask,
  type Logger,
  type ValidatePowerOnConfig,
  type ValidatePowerOnTaskDependencies,
} from '@libum-llc/pipelines-core';

import { createHTTPsClient, createSSHClient } from '../lib/task-orchestration';

import {
  resolveLocalPowerOnDirectory,
  resolveLocalPowerOnPath,
  toDeployedFileName,
  validatePowerOnDependencies,
} from './dependencies';

// `runValidatePowerOnTask` is the real thing from `@libum-llc/pipelines-core`:
// these tests exercise the seam between core's runner and this repo's
// dependency wiring, so stubbing the runner would remove the only thing under
// test. Only the Symitar boundary is stubbed, and the mock spreads
// `requireActual` so core's own use of the package (`SymitarSyncTransport`)
// still resolves.
jest.mock('@libum-llc/symitar', () => ({
  ...jest.requireActual('@libum-llc/symitar'),
  getSkipReasonForFile: jest.fn().mockResolvedValue(null),
}));

jest.mock('../lib/task-orchestration', () => ({
  createHTTPsClient: jest.fn(),
  createSSHClient: jest.fn(),
  loadValidateConfig: jest.fn(),
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
    symitarAppPort: 42627,
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

/**
 * Wires the real production dependencies (client factories, path
 * normalization and file filtering) around stubbed Symitar clients.
 *
 * `configOverrides` exists so tests can select the runner's validation mode.
 * With the default (empty) target branch the runner takes the hash-comparison
 * path and asks the Symitar client for changed files; setting `targetBranch`
 * to a `refs/heads/` ref takes the git-diff path through
 * `getGitChangedFiles` instead, which is stubbed here so no real `git` runs.
 */
function createHarness(
  deployed: string[],
  connectionType: 'https' | 'ssh',
  configOverrides: Partial<ValidatePowerOnConfig> = {},
) {
  const getChangedFiles = jest
    .fn()
    .mockResolvedValue({ deployed, deleted: [] });
  const validatePowerOn = jest
    .fn()
    .mockResolvedValue({ isValid: true, errors: '' });
  const getGitChangedFiles = jest.fn().mockReturnValue([]);

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
      setOutput: jest.fn(),
      warning: jest.fn(),
    },
    loadConfig: jest.fn().mockReturnValue(createConfig(configOverrides)),
    validateApiKey: jest.fn().mockResolvedValue(undefined),
    createTaskLogger: jest.fn().mockReturnValue(createLogger()),
    getGitChangedFiles,
    registerCleanup: jest.fn(),
  };

  return {
    dependencies,
    getChangedFiles,
    getGitChangedFiles,
    httpsClient,
    sshClient,
    validatePowerOn,
  };
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
      // Asserted against a literal, not against
      // `resolveLocalPowerOnDirectory()` - comparing two functions from the
      // module under test to each other would hold even if both were wrong.
      expect(resolveLocalPowerOnPath('REPWRITERSPECS/', 'REPWRITERSPECS')).toBe(
        path.join(WORKSPACE, 'REPWRITERSPECS'),
      );
    });
  });

  describe('resolveLocalPowerOnDirectory', () => {
    it.each([
      ['a trailing slash', 'REPWRITERSPECS/'],
      ['no trailing slash', 'REPWRITERSPECS'],
      ['backslashes', 'REPWRITERSPECS\\'],
    ])('anchors a directory with %s at the workspace', (_shape, directory) => {
      expect(resolveLocalPowerOnDirectory(directory)).toBe(
        path.join(WORKSPACE, 'REPWRITERSPECS'),
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

          // "exactly once": the file must not be validated twice, and must
          // not be silently dropped by a failed stat on a double-prefixed
          // path (which is how the original bug presented).
          expect(validatePowerOn).toHaveBeenCalledTimes(1);
          expect(validatePowerOn).toHaveBeenCalledWith(
            path.join(WORKSPACE, 'REPWRITERSPECS', 'FOO.PO'),
            { localIncludeDir: path.join(WORKSPACE, 'REPWRITERSPECS/') },
          );
          expect(getSkipReasonForFileMock).toHaveBeenCalledTimes(1);
          expect(getSkipReasonForFileMock).toHaveBeenCalledWith(
            path.join(WORKSPACE, 'REPWRITERSPECS', 'FOO.PO'),
          );

          // "without double-prefixing": no path handed to any Symitar call
          // may contain the PowerOn directory segment twice - the specific
          // REPWRITERSPECS/REPWRITERSPECS/ failure this wrapping exists to
          // prevent.
          const everyPathTouched = [
            ...validatePowerOn.mock.calls.flat(),
            ...getSkipReasonForFileMock.mock.calls.flat(),
          ]
            .map((argument) =>
              typeof argument === 'string'
                ? argument
                : JSON.stringify(argument),
            )
            .join('\n');
          expect(everyPathTouched).not.toContain(
            path.join('REPWRITERSPECS', 'REPWRITERSPECS'),
          );
          expect(everyPathTouched).not.toContain(
            'REPWRITERSPECS/REPWRITERSPECS',
          );
        },
      );

      // The runner's other change-detection branch. Before this, every test
      // here ran with `targetBranch: ''`, so `determineValidationMode`
      // always returned 'hash-comparison' and the git-diff path - including
      // the `filterChangedFiles` workspace anchoring it depends on - was
      // never executed.
      it('anchors git-diff changed files at the workspace', async () => {
        const {
          dependencies,
          getGitChangedFiles,
          getChangedFiles,
          validatePowerOn,
        } = createHarness([], connectionType, {
          targetBranch: 'refs/heads/main',
          targetBranchName: 'main',
        });
        getGitChangedFiles.mockReturnValue([
          { filePath: 'REPWRITERSPECS/FOO.PO', status: 'modified' },
        ]);

        await expect(runValidatePowerOnTask(dependencies)).resolves.toBe(
          'Successfully validated all changed PowerOns',
        );

        // git-diff mode must not consult the Symitar host for changes.
        expect(getChangedFiles).not.toHaveBeenCalled();
        expect(getGitChangedFiles).toHaveBeenCalledWith(
          'refs/heads/main',
          'REPWRITERSPECS/',
        );
        // The runner keeps repo-relative paths; the stat and the Symitar call
        // are anchored at the workspace by the dependency wrappers.
        expect(getSkipReasonForFileMock).toHaveBeenCalledWith(
          path.join(WORKSPACE, 'REPWRITERSPECS', 'FOO.PO'),
        );
        expect(validatePowerOn).toHaveBeenCalledTimes(1);
        expect(validatePowerOn).toHaveBeenCalledWith(
          path.join(WORKSPACE, 'REPWRITERSPECS', 'FOO.PO'),
          { localIncludeDir: path.join(WORKSPACE, 'REPWRITERSPECS/') },
        );
      });

      it('skips a git-diff changed file that symitar says is not a PowerOn', async () => {
        getSkipReasonForFileMock.mockResolvedValue('not a PowerOn file');
        const { dependencies, getGitChangedFiles, validatePowerOn } =
          createHarness([], connectionType, {
            targetBranch: 'refs/heads/main',
            targetBranchName: 'main',
          });
        getGitChangedFiles.mockReturnValue([
          { filePath: 'REPWRITERSPECS/FOO.PO', status: 'modified' },
        ]);

        await expect(runValidatePowerOnTask(dependencies)).resolves.toBe(
          'No changed PowerOn files found',
        );
        expect(validatePowerOn).not.toHaveBeenCalled();
      });

      it('scans the workspace-anchored PowerOn directory for changes', async () => {
        const { dependencies, getChangedFiles } = createHarness(
          ['FOO.PO'],
          connectionType,
        );

        await runValidatePowerOnTask(dependencies);

        const localDirectoryArgument =
          getChangedFiles.mock.calls[0][connectionType === 'ssh' ? 1 : 0];

        expect(localDirectoryArgument).toBe(
          path.join(WORKSPACE, 'REPWRITERSPECS/'),
        );
      });

      it('falls back to cwd-relative paths when the workspace is unset', async () => {
        delete process.env.GITHUB_WORKSPACE;
        const { dependencies, getChangedFiles, validatePowerOn } =
          createHarness(['FOO.PO'], connectionType);

        await runValidatePowerOnTask(dependencies);

        expect(
          getChangedFiles.mock.calls[0][connectionType === 'ssh' ? 1 : 0],
        ).toBe('REPWRITERSPECS/');
        expect(validatePowerOn).toHaveBeenCalledWith(
          path.join('REPWRITERSPECS', 'FOO.PO'),
          { localIncludeDir: 'REPWRITERSPECS/' },
        );
        expect(getSkipReasonForFileMock).toHaveBeenCalledWith(
          'REPWRITERSPECS/FOO.PO',
        );
      });
    },
  );

  // The wrappers layer overrides on with a Proxy rather than assigning them
  // onto the instance, so the caller's client is never mutated. Each
  // connection type has to assert against the client its own run actually
  // wrapped - checking the SSH client after an HTTPS-only run proves nothing,
  // because that client was never handed to a wrapper at all.
  it('leaves the wrapped HTTPS client unmutated', async () => {
    const { dependencies, getChangedFiles, httpsClient, validatePowerOn } =
      createHarness(['REPWRITERSPECS/FOO.PO'], 'https');

    await runValidatePowerOnTask(dependencies);

    // Sanity: the run really did go through the HTTPS client.
    expect(getChangedFiles).toHaveBeenCalled();
    expect(httpsClient.getChangedFiles).toBe(getChangedFiles);
    expect(httpsClient.validatePowerOn).toBe(validatePowerOn);
  });

  // Regression: the wrapper's own-property check used `in`, which walks the
  // prototype chain - so every member of `Object.prototype` tested true on the
  // overrides literal and was served from `Object.prototype`, unbound, instead
  // of being read from the wrapped client. `instanceof` still worked (there is
  // no getPrototypeOf trap), which is exactly why it went unnoticed.
  it('reads inherited members from the wrapped client, not Object.prototype', () => {
    class FakeSymitarClient {
      readonly marker = 'real-instance';

      getChangedFiles = jest.fn().mockResolvedValue({ deployed: [] });
      validatePowerOn = jest.fn();

      // Shadows Object.prototype.toString, which is what makes this
      // discriminating: with `in`, the wrapper served Object.prototype's copy
      // and this one was unreachable.
      toString(): string {
        return `client:${this.marker}`;
      }
    }

    const client = new FakeSymitarClient();
    createHTTPsClientMock.mockReturnValue(client as unknown as SymitarHTTPs);

    const wrapped = validatePowerOnDependencies.createHttpsClient(
      createConfig(),
    ) as unknown as FakeSymitarClient;

    expect(wrapped.toString()).toBe('client:real-instance');
    expect(String(wrapped)).toBe('client:real-instance');
    // `Object` before the fix; the client's own class after it. The name is
    // prefixed with `bound ` because the wrapper binds every function member.
    expect(wrapped.constructor.name).toBe('bound FakeSymitarClient');
  });

  it('leaves the wrapped SSH client and its validate worker unmutated', async () => {
    const { dependencies, getChangedFiles, sshClient } = createHarness(
      ['REPWRITERSPECS/FOO.PO'],
      'ssh',
    );
    const createValidateWorker = sshClient.createValidateWorker;

    await runValidatePowerOnTask(dependencies);

    expect(getChangedFiles).toHaveBeenCalled();
    expect(sshClient.getChangedFiles).toBe(getChangedFiles);
    expect(sshClient.createValidateWorker).toBe(createValidateWorker);
  });

  it('publishes the runner statistics through the task dependency', async () => {
    const { dependencies } = createHarness(['REPWRITERSPECS/FOO.PO'], 'https');

    await runValidatePowerOnTask(dependencies);

    expect(dependencies.task.setOutput).toHaveBeenCalledWith(
      'filesValidated',
      '1',
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

  /**
   * End-to-end proof that the action's three declared outputs really arrive as
   * *step outputs*.
   *
   * Every other test in this file substitutes a stub for `dependencies.task`,
   * which can only show that core called *something*. This one keeps the
   * production `validatePowerOnDependencies.task` - the real
   * `createGitHubTaskHost()` over the real, unmocked `@actions/core` - and
   * points `GITHUB_OUTPUT` and `GITHUB_ENV` at scratch files, so the assertion
   * is on what the GitHub runner would actually read back.
   *
   * The chain being proven is: core publishes `filesValidated` ->
   * the host translates it to `files-validated` -> `@actions/core` appends it
   * to `$GITHUB_OUTPUT` -> the runner exposes `steps.<id>.outputs.
   * files-validated`, which `.github/workflows/live-integration.yml` asserts
   * on. An implementation using `exportVariable` instead would write to
   * `$GITHUB_ENV`, which the empty-env assertion rejects.
   */
  it('publishes files-validated/passed/failed as real step outputs, not env vars', async () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-outputs-'));
    const outputFile = path.join(scratch, 'github_output');
    const envFile = path.join(scratch, 'github_env');
    fs.writeFileSync(outputFile, '');
    fs.writeFileSync(envFile, '');
    process.env.GITHUB_OUTPUT = outputFile;
    process.env.GITHUB_ENV = envFile;
    process.env['INPUT_CONNECTION-TYPE'] = 'https';

    try {
      const { dependencies } = createHarness(
        ['REPWRITERSPECS/FOO.PO'],
        'https',
      );

      await runValidatePowerOnTask({
        ...dependencies,
        // The production host, not the harness stub. This is the whole point.
        task: validatePowerOnDependencies.task,
      });

      const outputs = fs.readFileSync(outputFile, 'utf8');

      // The exact three names action.yml declares and the live-integration
      // workflow reads.
      expect(outputs).toMatch(/^files-validated<<[\s\S]*?^1$/m);
      expect(outputs).toMatch(/^files-passed<<[\s\S]*?^1$/m);
      expect(outputs).toMatch(/^files-failed<<[\s\S]*?^0$/m);
      // Nothing camelCase leaked through untranslated.
      expect(outputs).not.toContain('filesValidated');
      // And none of it went to the environment file instead.
      expect(fs.readFileSync(envFile, 'utf8')).toBe('');
    } finally {
      delete process.env.GITHUB_OUTPUT;
      delete process.env.GITHUB_ENV;
      delete process.env['INPUT_CONNECTION-TYPE'];
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });
});
