const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');

// Run-owned names avoid depending on an existing server file's content.
function prepare(runId, attempt) {
  assert.match(runId, /^\d+$/);
  assert.match(attempt, /^\d+$/);
  const prefix = `GHV_${runId}_${attempt}`;
  const root = '.integration-fixtures';
  assert.ok(!fs.existsSync(root), 'Fixture workspace already exists');
  for (const dir of ['valid', 'noop', 'git', 'selection'])
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  const valid = fs.readFileSync(
    '.github/workflows/live-integration-fixtures/valid/VALIDATE_ACTION_CI_VALID.PO',
  );
  const invalid = fs.readFileSync(
    '.github/workflows/live-integration-fixtures/invalid/VALIDATE_ACTION_CI_INVALID.PO',
  );
  fs.writeFileSync(path.join(root, 'valid', `${prefix}_VALID.PO`), valid);
  const git = (...args) => execFileSync('git', args, { stdio: 'pipe' });
  git('update-ref', 'refs/remotes/origin/live-fixture-base', 'HEAD');
  fs.writeFileSync(path.join(root, 'git', `${prefix}_GIT.PO`), valid);
  fs.writeFileSync(path.join(root, 'git', `${prefix}_IGNORED.PO`), invalid);
  fs.writeFileSync(path.join(root, 'git', `${prefix}_PRESERVED.PO`), invalid);
  git('add', '-f', '--', `${root}/git`);
  git(
    '-c',
    'user.name=Live Integration',
    '-c',
    'user.email=live-test@invalid.example',
    '-c',
    'core.hooksPath=/dev/null',
    'commit',
    '--no-gpg-sign',
    '-m',
    'Local-only live validation fixture',
  );
  for (const suffix of ['FIRST', 'SECOND', 'IGNORED', 'PRESERVED'])
    fs.writeFileSync(
      path.join(root, 'selection', `${prefix}_${suffix}.PO`),
      invalid,
    );
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    `ignored=${prefix}_IGNORED.PO\npreserved=${prefix}_PRESERVED.PO\n`,
  );
}
if (require.main === module)
  prepare(process.env.GITHUB_RUN_ID, process.env.GITHUB_RUN_ATTEMPT);
module.exports = { prepare };
