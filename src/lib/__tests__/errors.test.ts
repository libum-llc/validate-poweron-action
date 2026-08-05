import {
  PowerOnError,
  ConfigError,
  ValidationError,
  ConnectionError,
  AuthenticationError,
  SymNumberError,
  InputError,
  wrapError,
  isRetryableError,
} from '../errors';

describe('errors', () => {
  describe('PowerOnError', () => {
    it('should create error with message only', () => {
      const error = new PowerOnError('Test error');
      expect(error.message).toBe('Test error');
      expect(error.name).toBe('PowerOnError');
      expect(error.context).toBeUndefined();
      expect(error.originalError).toBeUndefined();
    });

    it('should create error with context', () => {
      const error = new PowerOnError('Test error', { key: 'value' });
      expect(error.context).toEqual({ key: 'value' });
    });

    it('should create error with original error', () => {
      const originalError = new Error('Original');
      const error = new PowerOnError('Test error', undefined, originalError);
      expect(error.originalError).toBe(originalError);
    });

    describe('getDetailedMessage', () => {
      it('should return message only when no context or original error', () => {
        const error = new PowerOnError('Test error');
        expect(error.getDetailedMessage()).toBe('Test error');
      });

      it('should include context in detailed message', () => {
        const error = new PowerOnError('Test error', { key: 'value', num: 42 });
        const message = error.getDetailedMessage();
        expect(message).toContain('Test error');
        expect(message).toContain('Context:');
        expect(message).toContain('key: "value"');
        expect(message).toContain('num: 42');
      });

      it('should include original error in detailed message', () => {
        const originalError = new Error('Original error');
        const error = new PowerOnError('Test error', undefined, originalError);
        const message = error.getDetailedMessage();
        expect(message).toContain('Test error');
        expect(message).toContain('Caused by: Original error');
      });

      it('should include both context and original error', () => {
        const originalError = new Error('Original error');
        const error = new PowerOnError(
          'Test error',
          { key: 'value' },
          originalError,
        );
        const message = error.getDetailedMessage();
        expect(message).toContain('Test error');
        expect(message).toContain('Context:');
        expect(message).toContain('key: "value"');
        expect(message).toContain('Caused by: Original error');
      });

      it('should handle empty context object', () => {
        const error = new PowerOnError('Test error', {});
        const message = error.getDetailedMessage();
        expect(message).toBe('Test error');
        expect(message).not.toContain('Context:');
      });
    });
  });

  describe('ConfigError', () => {
    it('should create config error', () => {
      const error = new ConfigError('Config failed', { file: 'config.yml' });
      expect(error.name).toBe('ConfigError');
      expect(error.message).toBe('Config failed');
      expect(error.context).toEqual({ file: 'config.yml' });
    });

    it('should extend PowerOnError', () => {
      const error = new ConfigError('Config failed');
      expect(error).toBeInstanceOf(PowerOnError);
    });
  });

  describe('ValidationError', () => {
    it('should create validation error without invalid files', () => {
      const error = new ValidationError('Validation failed');
      expect(error.name).toBe('ValidationError');
      expect(error.invalidFiles).toBeUndefined();
    });

    it('should create validation error with invalid files', () => {
      const invalidFiles = [
        { name: 'FILE1.PO', errors: 'Syntax error' },
        { name: 'FILE2.PO', errors: 'Missing variable' },
      ];
      const error = new ValidationError('Validation failed', invalidFiles);
      expect(error.invalidFiles).toEqual(invalidFiles);
    });

    describe('getAzureFormattedMessage', () => {
      it('should return message when no invalid files', () => {
        const error = new ValidationError('Validation failed');
        expect(error.getAzureFormattedMessage()).toBe('Validation failed');
      });

      it('should return message when invalid files is empty', () => {
        const error = new ValidationError('Validation failed', []);
        expect(error.getAzureFormattedMessage()).toBe('Validation failed');
      });

      it('should format invalid files for Azure Pipelines', () => {
        const invalidFiles = [
          {
            name: 'FILE1.PO',
            errors: 'Line 1: Syntax error\nLine 2: Missing semicolon',
          },
        ];
        const error = new ValidationError('Validation failed', invalidFiles);
        const message = error.getAzureFormattedMessage();
        expect(message).toContain('Validation failed:');
        expect(message).toContain('##[error] - FILE1.PO');
        expect(message).toContain('##[error]   Line 1: Syntax error');
        expect(message).toContain('##[error]   Line 2: Missing semicolon');
      });
    });
  });

  describe('ConnectionError', () => {
    it('should create connection error with all properties', () => {
      const originalError = new Error('Connection refused');
      const error = new ConnectionError(
        'Failed to connect',
        'symitar.example.com',
        22,
        true,
        originalError,
      );
      expect(error.name).toBe('ConnectionError');
      expect(error.hostname).toBe('symitar.example.com');
      expect(error.port).toBe(22);
      expect(error.retryable).toBe(true);
      expect(error.originalError).toBe(originalError);
    });

    it('should default retryable to false', () => {
      const error = new ConnectionError('Failed to connect');
      expect(error.retryable).toBe(false);
    });
  });

  describe('AuthenticationError', () => {
    it('should truncate API key to 8 characters', () => {
      const error = new AuthenticationError(
        'Invalid API key',
        'abcdefghijklmnop',
        'symitar.example.com',
      );
      expect(error.apiKeyPrefix).toBe('abcdefgh...');
      expect(error.hostname).toBe('symitar.example.com');
    });

    it('should handle undefined API key', () => {
      const error = new AuthenticationError('Invalid API key');
      expect(error.apiKeyPrefix).toBeUndefined();
    });

    it('should handle short API key', () => {
      const error = new AuthenticationError('Invalid API key', 'abc');
      expect(error.apiKeyPrefix).toBe('abc...');
    });
  });

  describe('SymNumberError', () => {
    it('should create sym number error with branch names', () => {
      const error = new SymNumberError('No sym found', 'develop', 'main');
      expect(error.name).toBe('SymNumberError');
      expect(error.branchName).toBe('develop');
      expect(error.targetBranchName).toBe('main');
    });

    it('should handle undefined branch names', () => {
      const error = new SymNumberError('No sym found');
      expect(error.branchName).toBeUndefined();
      expect(error.targetBranchName).toBeUndefined();
    });
  });

  describe('InputError', () => {
    it('should create input error with input name', () => {
      const error = new InputError('Invalid input', 'hostname', {
        value: 'bad@host',
      });
      expect(error.name).toBe('InputError');
      expect(error.inputName).toBe('hostname');
      expect(error.context).toEqual({
        inputName: 'hostname',
        value: 'bad@host',
      });
    });
  });

  describe('wrapError', () => {
    it('should return PowerOnError as-is', () => {
      const original = new PowerOnError('Test');
      const wrapped = wrapError(original);
      expect(wrapped).toBe(original);
    });

    it('should wrap standard Error', () => {
      const original = new Error('Standard error');
      const wrapped = wrapError(original);
      expect(wrapped).toBeInstanceOf(PowerOnError);
      expect(wrapped.message).toBe('Standard error');
      expect(wrapped.originalError).toBe(original);
    });

    it('should wrap standard Error with custom message', () => {
      const original = new Error('Standard error');
      const wrapped = wrapError(original, 'Custom message');
      expect(wrapped.message).toBe('Custom message');
    });

    it('should wrap unknown value', () => {
      const wrapped = wrapError('string error');
      expect(wrapped).toBeInstanceOf(PowerOnError);
      expect(wrapped.message).toBe('An unknown error occurred');
      expect(wrapped.context?.originalError).toBe('string error');
    });

    it('should wrap unknown value with custom message', () => {
      const wrapped = wrapError(42, 'Custom message');
      expect(wrapped.message).toBe('Custom message');
    });

    it('should include context when wrapping', () => {
      const wrapped = wrapError(new Error('Test'), 'Wrapped', {
        extra: 'data',
      });
      expect(wrapped.context).toEqual({ extra: 'data' });
    });
  });

  describe('isRetryableError', () => {
    it('should return true for retryable ConnectionError', () => {
      const error = new ConnectionError('Failed', 'host', 22, true);
      expect(isRetryableError(error)).toBe(true);
    });

    it('should return false for non-retryable ConnectionError', () => {
      const error = new ConnectionError('Failed', 'host', 22, false);
      expect(isRetryableError(error)).toBe(false);
    });

    it('should return false for other error types', () => {
      expect(isRetryableError(new PowerOnError('Test'))).toBe(false);
      expect(isRetryableError(new Error('Test'))).toBe(false);
      expect(isRetryableError('string')).toBe(false);
      expect(isRetryableError(null)).toBe(false);
    });
  });
});
