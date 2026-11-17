import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
const {
  createLicenseFixtureFetch,
} = require('../scripts/integration/license-fixture.js');
const { check, summarize } = require('../scripts/integration/report.js');

describe('live test licensing boundary and evidence', () => {
  it('simulates only the explicit test credential and forwards host/network requests', async () => {
    const realFetch = jest.fn().mockResolvedValue('real response');
    const fetchFixture = createLicenseFixtureFetch(realFetch, () => 'test-org');
    const response = await fetchFixture(
      'https://license.libum.io/subscriptionsByApiKey?product=poweron-pipelines',
      { headers: { 'X-API-Key': 'poweron-pipelines-live-test-only' } },
    );
    expect((await response.json()).subscriptions[0].organizationId).toBe(
      'test-org',
    );
    expect(realFetch).not.toHaveBeenCalled();
    await expect(
      fetchFixture('https://example.com/host-operation'),
    ).resolves.toBe('real response');
    expect(realFetch).toHaveBeenCalledTimes(1);
    await expect(
      fetchFixture(
        'https://license.libum.io/subscriptionsByApiKey?product=poweron-pipelines',
        { headers: { 'X-API-Key': 'not-a-test-key' } },
      ),
    ).rejects.toThrow('Unexpected licensing request');
  });
  it('requires an org ID and never silently falls through to real licensing', async () => {
    const realFetch = jest.fn();
    const fetchFixture = createLicenseFixtureFetch(realFetch, () => '');
    await expect(
      fetchFixture('https://license.libum.io/subscriptionsByApiKey'),
    ).rejects.toThrow('Missing POWERON_PIPELINES_ORG_ID');
    expect(realFetch).not.toHaveBeenCalled();
  });
  it('fails missing outputs and preserves failure timing', () => {
    expect(() => check('undefined/0', '1/0')).toThrow();
    expect(
      summarize(
        {
          start_push: { outputs: { time: '100' } },
          push: { outcome: 'failure' },
        },
        450,
      ),
    ).toEqual([{ scenario: 'push', outcome: 'failure', durationMs: 350 }]);
    expect(
      summarize(
        {
          start_pull: { outputs: { time: '100' } },
          end_pull: { outputs: { time: '350' } },
          pull: { outcome: 'success' },
        },
        450,
      )[0].durationMs,
    ).toBe(250);
  });
});

describe('packaged Action licensing preload', () => {
  it('loads in a real Node process from a workspace with spaces without a Windows-escaped absolute path', () => {
    const cwd = fs.mkdtempSync(
      path.join(os.tmpdir(), 'live preload with spaces '),
    );
    try {
      const scripts = path.join(cwd, 'scripts/integration');
      fs.mkdirSync(scripts, { recursive: true });
      for (const file of ['license-fixture.js', 'preload-license.js'])
        fs.copyFileSync(
          path.join(__dirname, '../scripts/integration', file),
          path.join(scripts, file),
        );
      const result = execFileSync(
        process.execPath,
        [
          '-e',
          "fetch('https://license.libum.io/subscriptionsByApiKey?product=poweron-pipelines', {headers:{'X-API-Key':'poweron-pipelines-live-test-only'}}).then(r=>r.json()).then(r=>{if(r.subscriptions[0].organizationId!=='preload-test-org') process.exit(1); console.log('preload verified');}).catch(()=>process.exit(1))",
        ],
        {
          cwd,
          timeout: 5000,
          encoding: 'utf8',
          env: {
            ...process.env,
            NODE_OPTIONS: '--require ./scripts/integration/preload-license.js',
            POWERON_PIPELINES_ORG_ID: 'preload-test-org',
          },
        },
      );
      expect(result).toContain('preload verified');
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});
