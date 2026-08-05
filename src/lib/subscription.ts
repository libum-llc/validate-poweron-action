import * as https from 'https';
import { DEFAULT_TIMEOUT } from './constants';
import { AuthenticationError, ConnectionError } from './errors';

// Disable SSL certificate globally
https.globalAgent.options.rejectUnauthorized = false;

// For development, you can set this to the appropriate value (e.g., 'dev-ci-', 'donnguyen-', etc.)
const sstStagePrefix = '';
const isSandbox = false;

/**
 * Validates the provided API key against License API for active subscription
 * @param apiKey The API key to validate
 * @param host The unique identifier for the host (restricted by subscription quantity)
 */
export const validateApiKey = (apiKey: string, host: string): Promise<void> => {
  const logPrefix = '[ValidateSubscription]';
  const maxRetries = 3;
  const normalizedApiKey = apiKey.trim();

  return new Promise(async (resolve, reject) => {
    console.info(`${logPrefix} Validating API key for host: ${host}`);

    if (!normalizedApiKey) {
      console.error(
        `${logPrefix} No API key provided. Please make sure 'apiKey' is set properly in your pipeline.`,
      );
      return reject(
        new AuthenticationError(
          'PowerOn Pipelines API Key is missing',
          normalizedApiKey,
          host,
        ),
      );
    }

    let attempt = 0;

    const url = `https://${sstStagePrefix}license${isSandbox ? '.libum-sandbox' : ''}.libum.io/subscriptionsByApiKey?product=poweron-pipelines&unit=${host}`;

    const attemptFetch = async (): Promise<void> => {
      attempt++;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

      try {
        const response = await fetch(url, {
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': normalizedApiKey,
          },
          signal: controller.signal,
          method: 'GET',
        });

        clearTimeout(timeout);

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

        if (!data || !data.isFound || data.subscriptions.length === 0) {
          if (!data.isFound) {
            throw new AuthenticationError(
              `Provided API key was not found. Please make sure 'apiKey' is set properly in your pipeline.`,
              normalizedApiKey,
              host,
            );
          } else if (data.subscriptions.length === 0) {
            throw new AuthenticationError(
              `No active subscription found for the provided API key.`,
              normalizedApiKey,
              host,
            );
          } else if (data.isMaxHostsExceeded) {
            throw new AuthenticationError(
              `Provided API key has reached the maximum number of hosts allowed for the subscription. Please upgrade your subscription or remove unused hosts.`,
              normalizedApiKey,
              host,
            );
          } else {
            throw new AuthenticationError(
              `Unexpected response format: ${JSON.stringify(data)}`,
              normalizedApiKey,
              host,
            );
          }
        }

        console.info(`${logPrefix} API key validation successful`);
        resolve();
      } catch (error: any) {
        clearTimeout(timeout);

        console.error(
          `${logPrefix} Validation attempt ${attempt} failed: ${error.message}`,
        );

        if (attempt < maxRetries) {
          console.info(`${logPrefix} Retrying API key validation...`);
          setTimeout(attemptFetch, 1000);
        } else {
          // If the last error was already our custom error, preserve it
          if (
            error instanceof AuthenticationError ||
            error instanceof ConnectionError
          ) {
            reject(error);
          } else {
            reject(
              new ConnectionError(
                'Failed to fetch PowerOn Pipelines API key subscription data after multiple attempts',
                `license${isSandbox ? '.libum-sandbox' : ''}.libum.io`,
                443,
                false,
                error,
              ),
            );
          }
        }
      }
    };

    attemptFetch();
  });
};
