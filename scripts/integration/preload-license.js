// Test-only preload; never imported by src/ or included in dist/.
const { createLicenseFixtureFetch } = require('./license-fixture.js');
globalThis.fetch = createLicenseFixtureFetch(
  globalThis.fetch.bind(globalThis),
  () => process.env.POWERON_PIPELINES_ORG_ID,
);
