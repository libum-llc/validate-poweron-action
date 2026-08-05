import { validateApiKey } from '../subscription';

// Mock the global fetch
global.fetch = jest.fn();

describe('subscription', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // Helper to run validation with timers - handles nested setTimeout calls
  const runValidationWithTimers = async (promise: Promise<void>) => {
    const result = promise.catch((e) => e);

    // Run all timers including nested ones
    while (jest.getTimerCount() > 0) {
      await jest.runAllTimersAsync();
    }

    return await result;
  };

  describe('validateApiKey', () => {
    it('should successfully validate a valid API key', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          isFound: true,
          subscriptions: [{ id: 'sub-123', status: 'active' }],
          isMaxHostsExceeded: false,
        }),
      };

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      await expect(
        validateApiKey('sk-test-key', 'symitar-host.com'),
      ).resolves.toBeUndefined();

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('license.libum.io/subscriptionsByApiKey'),
        expect.objectContaining({
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': 'sk-test-key',
          },
          method: 'GET',
        }),
      );
    });

    it('should trim surrounding whitespace before sending the API key', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          isFound: true,
          subscriptions: [{ id: 'sub-123', status: 'active' }],
          isMaxHostsExceeded: false,
        }),
      };

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      await expect(
        validateApiKey('  sk-test-key  ', 'symitar-host.com'),
      ).resolves.toBeUndefined();

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-API-Key': 'sk-test-key',
          }),
        }),
      );
    });

    it('should include the host in the query parameters', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          isFound: true,
          subscriptions: [{ id: 'sub-123' }],
        }),
      };

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      await validateApiKey('sk-test-key', 'test-host');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('unit=test-host'),
        expect.any(Object),
      );
    });

    it('should reject when API key is empty', async () => {
      await expect(validateApiKey('', 'symitar-host.com')).rejects.toThrow(
        'PowerOn Pipelines API Key is missing',
      );

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should reject when API key is not found', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          isFound: false,
          subscriptions: [],
        }),
      };

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      // Start validation, advance timers, and check result
      const result = await runValidationWithTimers(
        validateApiKey('sk-invalid', 'symitar-host.com'),
      );

      // Now returns the specific AuthenticationError instead of generic message
      expect(result).toBeInstanceOf(Error);
      expect(result.message).toContain('Provided API key was not found');
    });

    it('should reject when no active subscriptions found', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          isFound: true,
          subscriptions: [],
        }),
      };

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const result = await runValidationWithTimers(
        validateApiKey('sk-test-key', 'symitar-host.com'),
      );

      expect(result).toBeInstanceOf(Error);
      expect(result.message).toContain('No active subscription found');
    });

    it('should reject when max hosts exceeded', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          isFound: true,
          subscriptions: [],
          isMaxHostsExceeded: true,
        }),
      };

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const result = await runValidationWithTimers(
        validateApiKey('sk-test-key', 'symitar-host.com'),
      );

      expect(result).toBeInstanceOf(Error);
      expect(result.message).toContain('No active subscription found');
    });

    it('should reject when API response is not ok', async () => {
      const mockResponse = {
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      };

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const result = await runValidationWithTimers(
        validateApiKey('sk-test-key', 'symitar-host.com'),
      );

      expect(result).toBeInstanceOf(Error);
      expect(result.message).toContain('Failed to validate API key');
    });

    it('should retry up to 3 times on failure', async () => {
      const mockFailure = {
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      };

      (global.fetch as jest.Mock).mockResolvedValue(mockFailure);

      const result = await runValidationWithTimers(
        validateApiKey('sk-test-key', 'symitar-host.com'),
      );

      expect(result).toBeInstanceOf(Error);
      expect(result.message).toContain('Failed to validate API key');

      expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    it('should succeed on retry after initial failure', async () => {
      const mockFailure = {
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      };

      const mockSuccess = {
        ok: true,
        json: async () => ({
          isFound: true,
          subscriptions: [{ id: 'sub-123' }],
        }),
      };

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(mockFailure)
        .mockResolvedValueOnce(mockSuccess);

      const result = await runValidationWithTimers(
        validateApiKey('sk-test-key', 'symitar-host.com'),
      );

      expect(result).toBeUndefined();
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should handle fetch timeout', async () => {
      (global.fetch as jest.Mock).mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve({ ok: false }), 60000); // Never resolves in time
          }),
      );

      const result = await runValidationWithTimers(
        validateApiKey('sk-test-key', 'symitar-host.com'),
      );

      expect(result).toBeInstanceOf(Error);
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    it('should handle network errors', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      const result = await runValidationWithTimers(
        validateApiKey('sk-test-key', 'symitar-host.com'),
      );

      expect(result).toBeInstanceOf(Error);
      expect(result.message).toContain(
        'Failed to fetch PowerOn Pipelines API key subscription data after multiple attempts',
      );

      expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    it('should handle unexpected response format', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          // Missing expected fields
          someOtherField: 'value',
        }),
      };

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const result = await runValidationWithTimers(
        validateApiKey('sk-test-key', 'symitar-host.com'),
      );

      expect(result).toBeInstanceOf(Error);
      expect(result.message).toContain('Provided API key was not found');
    });
  });
});
