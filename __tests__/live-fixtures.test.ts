import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
const { prepare } = require('../scripts/integration/prepare.js');

describe('live validation fixture selection', () => {
  it('creates a local-only git diff with valid, ignored, and preserved fixtures', () => {
    const originalCwd = process.cwd();
    const oldOutput = process.env.GITHUB_OUTPUT;
    const workspace = fs.mkdtempSync(
      path.join(os.tmpdir(), 'validation-fixture-test-'),
    );
    try {
      fs.cpSync(
        path.join(originalCwd, '.github/workflows/live-integration-fixtures'),
        path.join(workspace, '.github/workflows/live-integration-fixtures'),
        { recursive: true },
      );
      fs.copyFileSync(
        path.join(originalCwd, '.gitattributes'),
        path.join(workspace, '.gitattributes'),
      );
      process.chdir(workspace);
      process.env.GITHUB_OUTPUT = path.join(workspace, 'outputs');
      const git = (...args: string[]) =>
        execFileSync('git', args, { encoding: 'utf8', stdio: 'pipe' });
      git('init');
      git('add', '.github', '.gitattributes');
      git(
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@invalid.example',
        '-c',
        'core.hooksPath=/dev/null',
        'commit',
        '--no-gpg-sign',
        '-m',
        'Fixture baseline',
      );
      git('-c', 'core.autocrlf=true', 'checkout-index', '--force', '--all');
      expect(
        fs
          .readFileSync(
            '.github/workflows/live-integration-fixtures/valid/VALIDATE_ACTION_CI_VALID.PO',
          )
          .includes(13),
      ).toBe(false);
      // Simulate a persistent Windows worktree left over from before the LF rule.
      const validFixture =
        '.github/workflows/live-integration-fixtures/valid/VALIDATE_ACTION_CI_VALID.PO';
      fs.writeFileSync(
        validFixture,
        fs.readFileSync(validFixture, 'utf8').replace(/\n/g, '\r\n'),
      );
      prepare('123', '1');
      expect(
        fs
          .readFileSync('.integration-fixtures/valid/GHV_123_1_VALID.PO')
          .includes(13),
      ).toBe(false);

      expect(git('remote')).toBe('');
      const changed = git('diff', '--name-only', 'origin/live-fixture-base...')
        .trim()
        .split('\n');
      expect(changed).toEqual([
        '.integration-fixtures/git/GHV_123_1_GIT.PO',
        '.integration-fixtures/git/GHV_123_1_IGNORED.PO',
        '.integration-fixtures/git/GHV_123_1_PRESERVED.PO',
      ]);
      expect(fs.readdirSync('.integration-fixtures/selection')).toHaveLength(4);
      expect(fs.readdirSync('.integration-fixtures/noop')).toEqual([]);
      expect(fs.readFileSync('outputs', 'utf8')).toContain(
        'ignored=GHV_123_1_IGNORED.PO',
      );
    } finally {
      process.chdir(originalCwd);
      if (oldOutput === undefined) delete process.env.GITHUB_OUTPUT;
      else process.env.GITHUB_OUTPUT = oldOutput;
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });
});
