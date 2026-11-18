// Receives only step status/timestamps, never credentials or action logs.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
function check(actual, expected) {
  assert.equal(actual, expected, 'Unexpected live Action outputs');
}
function summarize(steps, now = Date.now()) {
  return Object.entries(steps)
    .filter(([name]) => name.startsWith('start_'))
    .map(([name, step]) => {
      const id = name.slice(6);
      const start = Number(step.outputs?.time);
      const end = Number(steps[`end_${id}`]?.outputs?.time) || now;
      return {
        scenario: id,
        outcome: steps[id]?.outcome || 'not-run',
        durationMs: Number.isFinite(start) ? end - start : null,
      };
    });
}
if (require.main === module) {
  if (process.argv[2] === 'check')
    check(process.env.ACTUAL, process.env.EXPECTED);
  else if (process.argv[2] === 'clock')
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `time=${Date.now()}\n`);
  else {
    const results = summarize(JSON.parse(process.env.STEPS));
    fs.mkdirSync('.integration-results', { recursive: true });
    fs.writeFileSync(
      path.join('.integration-results', 'timings.json'),
      JSON.stringify(results, null, 2),
    );
    fs.appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      '## Symitar Connector Live Integration\n\nLicensing is simulated; host operations and the committed Action bundle are real.\n\n| Scenario | Outcome | Seconds |\n| --- | --- | --- |\n' +
        results
          .map(
            (x) =>
              `| ${x.scenario} | ${x.outcome} | ${x.durationMs === null ? 'unknown' : (x.durationMs / 1000).toFixed(2)} |`,
          )
          .join('\n') +
        '\n',
    );
  }
}
module.exports = { check, summarize };
