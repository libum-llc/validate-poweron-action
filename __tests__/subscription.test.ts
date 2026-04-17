import { validateApiKey, AuthenticationError, ConnectionError } from '../src/subscription';

// Mock global fetch
global.fetch = jest.fn();

describe('subscription', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('validateApiKey', () => {
    const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

    it('should successfully validate a valid API key', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          isFound: true,
          subscriptions: [{ id: 'sub-123', status: 'active' }],
        }),
      } as Response);

      await expect(validateApiKey('valid-key', 'test-host.example.com')).resolves.toBeUndefined();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('license.libum.io/subscriptionsByApiKey'),
        expect.objectContaining({
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': 'valid-key',
          },
          method: 'GET',
        }),
      );
    });

    it('should reject when API key is empty', async () => {
      await expect(validateApiKey('', 'test-host.example.com')).rejects.toThrow(
        AuthenticationError,
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should include product and unit query parameters in request URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          isFound: true,
          subscriptions: [{ id: 'sub-123', status: 'active' }],
        }),
      } as Response);

      await validateApiKey('valid-key', 'test-host.example.com');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('product=poweron-pipelines'),
        expect.any(Object),
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('unit=test-host.example.com'),
        expect.any(Object),
      );
    });

    it('should trim surrounding whitespace from API key before validation', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          isFound: true,
          subscriptions: [{ id: 'sub-123', status: 'active' }],
        }),
      } as Response);

      await expect(
        validateApiKey('  valid-key-with-whitespace  ', 'test-host.example.com'),
      ).resolves.toBeUndefined();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-API-Key': 'valid-key-with-whitespace',
          }),
        }),
      );
    });

    it('should reject when max hosts exceeded', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          isFound: true,
          subscriptions: [{ id: 'sub-123', status: 'active' }],
          isMaxHostsExceeded: true,
        }),
      } as Response);

      await expect(validateApiKey('valid-key', 'test-host.example.com')).rejects.toThrow(
        AuthenticationError,
      );
    });
  });

  describe('AuthenticationError', () => {
    it('should create error with correct properties', () => {
      const error = new AuthenticationError('Test message', 'test-key', 'test-host');

      expect(error.message).toBe('Test message');
      expect(error.apiKey).toBe('test-key');
      expect(error.host).toBe('test-host');
      expect(error.name).toBe('AuthenticationError');
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe('ConnectionError', () => {
    it('should create error with correct properties', () => {
      const originalError = new Error('Original error');
      const error = new ConnectionError('Test message', 'test-host', 443, true, originalError);

      expect(error.message).toBe('Test message');
      expect(error.host).toBe('test-host');
      expect(error.port).toBe(443);
      expect(error.isSSL).toBe(true);
      expect(error.originalError).toBe(originalError);
      expect(error.name).toBe('ConnectionError');
      expect(error).toBeInstanceOf(Error);
    });

    it('should create error without originalError', () => {
      const error = new ConnectionError('Test message', 'test-host', 443, false);

      expect(error.message).toBe('Test message');
      expect(error.originalError).toBeUndefined();
    });
  });
});
