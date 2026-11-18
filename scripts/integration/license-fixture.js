// Test harness only. Never imported by a production task or included in bundles.
function createLicenseFixtureFetch(realFetch, getOrgId) {
  return async function fixtureFetch(input, init) {
    const url = new URL(
      typeof input === 'string' ? input : (input.url ?? input),
    );
    if (
      url.origin !== 'https://license.libum.io' ||
      url.pathname !== '/subscriptionsByApiKey'
    ) {
      return realFetch(input, init);
    }

    const orgId = getOrgId()?.trim();
    const headers = new Headers(init?.headers ?? input.headers);
    if (!orgId)
      throw new Error(
        'Missing POWERON_PIPELINES_ORG_ID for simulated licensing',
      );
    if (
      headers.get('X-API-Key') !== 'poweron-pipelines-live-test-only' ||
      url.searchParams.get('product') !== 'poweron-pipelines' ||
      (init?.method ?? input.method ?? 'GET') !== 'GET'
    ) {
      throw new Error('Unexpected licensing request in live test harness');
    }

    console.info(
      '[IntegrationLicenseFixture] Simulated licensing; real entitlement is not checked.',
    );
    return Response.json({
      isFound: true,
      isMaxHostsExceeded: false,
      subscriptions: [
        {
          id: 'integration-fixture',
          organizationId: orgId,
          status: 'active',
        },
      ],
    });
  };
}

module.exports = { createLicenseFixtureFetch };
