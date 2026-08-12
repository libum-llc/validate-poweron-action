import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { createGitHubTaskHost } from '../github-task-host';

/**
 * These tests deliberately do NOT mock `@actions/core`.
 *
 * The claim under test is that `TaskHost.setOutput` produces a real *step
 * output* - something a later workflow step can read as
 * `steps.<id>.outputs.files-validated` - and not an environment variable. A
 * mocked `@actions/core` could only prove that some function was called; it
 * could not tell `setOutput` from `exportVariable`, which is exactly the
 * confusion that fails silently. So the real toolkit runs against real
 * `GITHUB_OUTPUT` / `GITHUB_ENV` files and the assertions read what it wrote.
 *
 * `@actions/core` writes outputs to `$GITHUB_OUTPUT` as a heredoc record
 * (`name<<delimiter\nvalue\ndelimiter`) and environment variables to
 * `$GITHUB_ENV` in the same shape. The runner reads the first as step outputs
 * and the second as env. If `setOutput` were implemented with
 * `core.exportVariable`, the value would land in the env file instead and
 * `steps.<id>.outputs.*` would be empty - the assertions below fail in both
 * directions for exactly that reason.
 */
describe('createGitHubTaskHost', () => {
  const originalEnv = { ...process.env };
  let scratch: string;
  let outputFile: string;
  let envFile: string;

  beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-task-host-'));
    outputFile = path.join(scratch, 'github_output');
    envFile = path.join(scratch, 'github_env');
    fs.writeFileSync(outputFile, '');
    fs.writeFileSync(envFile, '');
    process.env.GITHUB_OUTPUT = outputFile;
    process.env.GITHUB_ENV = envFile;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  describe('setOutput', () => {
    it('writes a real step output, not an environment variable', () => {
      createGitHubTaskHost().setOutput('filesValidated', '7');

      const outputs = fs.readFileSync(outputFile, 'utf8');
      const envs = fs.readFileSync(envFile, 'utf8');

      // The step-output file carries the value...
      expect(outputs).toContain('files-validated');
      expect(outputs).toMatch(/^files-validated<<.+$/m);
      expect(outputs).toMatch(/^7$/m);
      // ...and the environment file is untouched. This is the assertion that
      // distinguishes core.setOutput from core.exportVariable.
      expect(envs).toBe('');
      expect(envs).not.toContain('files-validated');
    });

    it.each([
      ['filesValidated', 'files-validated'],
      ['filesPassed', 'files-passed'],
      ['filesFailed', 'files-failed'],
    ])(
      'publishes core output %s under the action.yml name %s',
      (coreName, actionName) => {
        createGitHubTaskHost().setOutput(coreName, '0');

        // The names asserted here are the three `outputs:` entries in
        // action.yml and the three the live-integration workflow reads back.
        expect(fs.readFileSync(outputFile, 'utf8')).toMatch(
          new RegExp(`^${actionName}<<`, 'm'),
        );
      },
    );
  });

  describe('getInput', () => {
    it('reads an action.yml input under its kebab-case name', () => {
      process.env['INPUT_CONNECTION-TYPE'] = 'ssh';

      expect(createGitHubTaskHost().getInput('connectionType')).toBe('ssh');
    });

    it('throws when a required input is missing', () => {
      expect(() =>
        createGitHubTaskHost().getInput('symitarHostname', true),
      ).toThrow(/symitar-hostname/);
    });

    it('returns an empty string for an absent optional input', () => {
      expect(createGitHubTaskHost().getInput('targetBranch')).toBe('');
    });
  });

  describe('log channels', () => {
    it.each([
      ['warning', '::warning::'],
      ['error', '::error::'],
      ['debug', '::debug::'],
      ['info', 'something happened'],
    ] as const)('emits %s on stdout', (channel, marker) => {
      process.env.RUNNER_DEBUG = '1';
      const write = jest
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true);

      createGitHubTaskHost()[channel]('something happened');

      expect(write.mock.calls.flat().join('')).toContain(marker);
      write.mockRestore();
    });

    it('registers a secret with the runner mask', () => {
      const write = jest
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true);

      createGitHubTaskHost().setSecret('super-secret');

      expect(write.mock.calls.flat().join('')).toContain(
        '::add-mask::super-secret',
      );
      write.mockRestore();
    });
  });
});
