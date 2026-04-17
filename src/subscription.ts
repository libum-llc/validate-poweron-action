/**
 * Maximum time to wait for API response before timing out.
 * Set to 30 seconds to account for cold starts and network latency.
 */
const API_REQUEST_TIMEOUT_MS = 30000;

/**
 * Number of times to retry failed API requests.
 * Retries handle transient network failures.
 */
const MAX_API_RETRIES = 3;

/**
 * SST stage prefix for development environments.
 * Can be set via environment variable SST_STAGE_PREFIX.
 */
const sstStagePrefix = process.env.SST_STAGE_PREFIX || '';

/**
 * Whether to use sandbox environment.
 * Can be set via environment variable IS_SANDBOX=true.
 */
const isSandbox = process.env.IS_SANDBOX === 'true';

/**
 * Response structure from the subscription API.
 */
interface SubscriptionResponse {
  isFound: boolean;
  subscriptions: Array<{
    id: string;
    status: string;
  }>;
  isMaxHostsExceeded?: boolean;
}

/**
 * Type guard to validate subscription API response structure.
 * @param data - Unknown data from API response
 * @returns True if data matches SubscriptionResponse interface
 */
function isSubscriptionResponse(data: unknown): data is SubscriptionResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    'isFound' in data &&
    typeof (data as Record<string, unknown>).isFound === 'boolean' &&
    'subscriptions' in data &&
    Array.isArray((data as Record<string, unknown>).subscriptions)
  );
}

/**
 * Custom error class for API authentication failures.
 * Thrown when API key validation fails due to missing/invalid credentials.
 */
export class AuthenticationError extends Error {
  constructor(
    message: string,
    public readonly apiKey: string,
    public readonly host: string,
  ) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

/**
 * Custom error class for connection failures.
 * Thrown when unable to connect to the license server.
 */
export class ConnectionError extends Error {
  constructor(
    message: string,
    public readonly host: string,
    public readonly port: number,
    public readonly isSSL: boolean,
    public readonly originalError?: Error,
  ) {
    super(message);
    this.name = 'ConnectionError';
  }
}

/**
 * Validates the provided API key against License API for active subscription.
 *
 * @param apiKey - The API key to validate
 * @param host - The unique identifier for the host (restricted by subscription quantity)
 * @throws {AuthenticationError} When API key is invalid or subscription is not active
 * @throws {ConnectionError} When unable to connect to license server after retries
 */
export const validateApiKey = async (apiKey: string, host: string): Promise<void> => {
  const logPrefix = '[ValidateSubscription]';
  const normalizedApiKey = apiKey.trim();
  console.info(`${logPrefix} Validating API key for host: ${host}`);

  if (!normalizedApiKey) {
    console.error(
      `${logPrefix} No API key provided. Please make sure 'api-key' is set properly in your workflow.`,
    );
    throw new AuthenticationError('PowerOn Pipelines API Key is missing', normalizedApiKey, host);
  }

  const url = `https://${sstStagePrefix}license${isSandbox ? '.libum-sandbox' : ''}.libum.io/subscriptionsByApiKey?product=poweron-pipelines&unit=${host}`;

  for (let attempt = 1; attempt <= MAX_API_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': normalizedApiKey,
        },
        signal: controller.signal,
        method: 'GET',
      });

      if (!response.ok) {
        console.error(
          `${logPrefix} Failed to validate API key. Status: ${response.status}, Message: ${response.statusText}`,
        );
        throw new AuthenticationError(
          `Failed to validate API key: ${response.status} ${response.statusText}`,
          normalizedApiKey,
          host,
        );
      }

      const data = await response.json();

      // Validate response structure with type guard
      if (!isSubscriptionResponse(data)) {
        throw new AuthenticationError(
          'Invalid response format from license server',
          normalizedApiKey,
          host,
        );
      }

      if (!data.isFound) {
        throw new AuthenticationError(
          `Provided API key was not found. Please make sure 'api-key' is set properly in your workflow.`,
          normalizedApiKey,
          host,
        );
      }

      if (data.subscriptions.length === 0) {
        throw new AuthenticationError(
          `No active subscription found for the provided API key.`,
          normalizedApiKey,
          host,
        );
      }

      // Check if maximum hosts exceeded
      if (data.isMaxHostsExceeded) {
        throw new AuthenticationError(
          `Provided API key has reached the maximum number of hosts allowed for the subscription. Please upgrade your subscription or remove unused hosts.`,
          normalizedApiKey,
          host,
        );
      }

      console.info(`${logPrefix} API key validation successful`);
      return;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`${logPrefix} Validation attempt ${attempt} failed: ${errorMessage}`);

      // If it's our custom error or last attempt, throw immediately
      if (
        error instanceof AuthenticationError ||
        error instanceof ConnectionError ||
        attempt >= MAX_API_RETRIES
      ) {
        if (error instanceof AuthenticationError || error instanceof ConnectionError) {
          throw error;
        }

        throw new ConnectionError(
          'Failed to fetch PowerOn Pipelines API key subscription data after multiple attempts',
          `license${isSandbox ? '.libum-sandbox' : ''}.libum.io`,
          443,
          true, // HTTPS connection
          error instanceof Error ? error : new Error(String(error)),
        );
      }

      // Exponential backoff for retries: 500ms, 1s, 2s
      const delay = Math.min(500 * Math.pow(2, attempt - 1), 10000);
      console.info(`${logPrefix} Retrying API key validation in ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    } finally {
      clearTimeout(timeout); // Guarantee timeout is cleared
    }
  }
};
