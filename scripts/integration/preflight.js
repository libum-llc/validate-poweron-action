// Credential presence and host trust only: this script never connects.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
function preflight(env = process.env) {
  for (const name of [
    'AIX_PASSWORD',
    'SYM_PASSWORD',
    'POWERON_PIPELINES_ORG_ID',
    'LIVE_HOSTNAME',
    'LIVE_SSH_USERNAME',
    'LIVE_SYM_NUMBER',
    'LIVE_SYM_USER_NUMBER',
  ]) {
    if (!env[name]?.trim())
      throw new Error(`Missing ${name}; no live connection attempted.`);
  }
  if (!/^\d{1,3}$/.test(env.LIVE_SYM_NUMBER.trim()))
    throw new Error('Invalid LIVE_SYM_NUMBER; no live connection attempted.');
  if (env.HOST_KEY?.trim()) return;
  const knownHosts = path.join(os.homedir(), '.ssh', 'known_hosts');
  if (!fs.existsSync(knownHosts))
    throw new Error(
      'Set SYMITAR_SSH_HOST_KEY or provision the approved host key in the runner account known_hosts.',
    );
  try {
    const result = execFileSync(
      'ssh-keygen',
      ['-F', env.LIVE_HOSTNAME.trim(), '-f', knownHosts],
      { encoding: 'utf8', stdio: 'pipe', timeout: 5000 },
    );
    if (!result.trim()) throw new Error('No host key');
  } catch {
    throw new Error(
      'Approved host trust is unavailable; no live connection attempted.',
    );
  }
}
if (require.main === module) preflight();
module.exports = { preflight };
