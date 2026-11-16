import { readFileSync } from 'fs';
import * as path from 'path';

// Read the committed workflow: every host call is an explicit local-action step.
const source = readFileSync(
  path.join(__dirname, '../../../.github/workflows/live-integration.yml'),
  'utf8',
);
const executable = source
  .split('\n')
  .filter((line) => !line.trim().startsWith('#'))
  .join('\n');

describe('live workflow connection budget', () => {
  it('runs manually, never on PRs, pushes or schedules', () => {
    expect(executable).toMatch(/^  workflow_dispatch:$/m);
    expect(executable).not.toMatch(
      /^  (push|pull_request|pull_request_target|schedule):/m,
    );
  });
  it('makes one action attempt, uses explicit trust and stops on failure', () => {
    expect(executable.match(/uses: \.\//g)).toHaveLength(1);
    expect(executable).toContain(
      'ssh-host-key: ${{ vars.SYMITAR_SSH_HOST_KEY }}',
    );
    expect(executable).not.toContain('continue-on-error');
    expect(executable).not.toContain('connection-type:');
    expect(executable).not.toContain('invalid/');
  });
});
