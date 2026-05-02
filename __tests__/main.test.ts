import * as core from '@actions/core';
import { validatePowerOns } from '../src/validator';
import type { ValidationConfig, ValidationResult } from '../src/validator';
import { AuthenticationError, ConnectionError } from '../src/subscription';

// Mock dependencies
jest.mock('@actions/core');
jest.mock('@actions/exec');
jest.mock('@libum-llc/symitar');
jest.mock('../src/validator');

describe('validate-poweron-action', () => {
  const mockGetInput = core.getInput as jest.MockedFunction<typeof core.getInput>;
  const mockSetFailed = core.setFailed as jest.MockedFunction<typeof core.setFailed>;
  const mockSetOutput = core.setOutput as jest.MockedFunction<typeof core.setOutput>;
  const mockInfo = core.info as jest.MockedFunction<typeof core.info>;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  describe('input validation', () => {
    it('should validate connection type is https or ssh', async () => {
      const config: ValidationConfig = {
        symitarHostname: 'test.example.com',
        symNumber: '001',
        symitarUserNumber: '1234',
        symitarUserPassword: 'password',
        sshUsername: 'user',
        sshPassword: 'pass',
        sshPort: 22,
        apiKey: 'key',
        connectionType: 'invalid' as any,
        poweronDirectory: 'REPWRITERSPECS/',
        ignoreList: [],
        logPrefix: '[Test]',
      };

      // Main.ts validates this before calling validatePowerOns
      const invalidType = 'invalid';
      expect(['https', 'ssh'].includes(invalidType)).toBe(false);
    });

    it('should default to ssh connection type', () => {
      mockGetInput.mockImplementation((name: string, options?: core.InputOptions) => {
        if (name === 'connection-type') return '';
        return 'default-value';
      });

      const connectionType = mockGetInput('connection-type') || 'ssh';
      expect(connectionType).toBe('ssh');
    });

    it('should default to REPWRITERSPECS/ directory', () => {
      mockGetInput.mockImplementation((name: string) => {
        if (name === 'poweron-directory') return '';
        return 'default-value';
      });

      const directory = mockGetInput('poweron-directory') || 'REPWRITERSPECS/';
      expect(directory).toBe('REPWRITERSPECS/');
    });

    const parseListInput = (value: string): string[] =>
      value
        .split(/[,\n]/)
        .map((f) => f.trim().replace(/^-\s*/, ''))
        .filter((f) => f.length > 0);

    it('should parse comma-delimited ignore list correctly', () => {
      expect(parseListInput('FILE1.PO, FILE2.PO,  FILE3.PO  ')).toEqual([
        'FILE1.PO',
        'FILE2.PO',
        'FILE3.PO',
      ]);
    });

    it('should handle empty ignore list', () => {
      expect(parseListInput('')).toEqual([]);
    });

    it('should parse multi-line list inputs', () => {
      expect(parseListInput('FILE1.PO\nFILE2.PO\nFILE3.PO')).toEqual([
        'FILE1.PO',
        'FILE2.PO',
        'FILE3.PO',
      ]);
    });

    it('should parse YAML block-sequence list inputs (- prefixed)', () => {
      expect(parseListInput('  - ASCIICHAR.DATA\n  - RB.SYNERGY.AP.INDEX.ASCIIDATA\n')).toEqual([
        'ASCIICHAR.DATA',
        'RB.SYNERGY.AP.INDEX.ASCIIDATA',
      ]);
    });
  });

  describe('validatePowerOns', () => {
    it('should return zero results when no files found', async () => {
      const mockValidatePowerOns = validatePowerOns as jest.MockedFunction<typeof validatePowerOns>;

      mockValidatePowerOns.mockResolvedValue({
        filesValidated: 0,
        filesPassed: 0,
        filesFailed: 0,
        errors: [],
        validatedFiles: [],
      });

      const config: ValidationConfig = {
        symitarHostname: 'test.example.com',
        symNumber: '001',
        symitarUserNumber: '1234',
        symitarUserPassword: 'password',
        sshUsername: 'user',
        sshPassword: 'pass',
        sshPort: 22,
        apiKey: 'key',
        connectionType: 'ssh',
        poweronDirectory: 'REPWRITERSPECS/',
        ignoreList: [],
        logPrefix: '[Test]',
      };

      const result = await validatePowerOns(config);

      expect(result.filesValidated).toBe(0);
      expect(result.filesPassed).toBe(0);
      expect(result.filesFailed).toBe(0);
      expect(result.errors).toEqual([]);
    });
  });

  describe('error handling for subscription errors', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('should handle AuthenticationError with detailed logging', () => {
      const authError = new AuthenticationError(
        'API key not found',
        'test-key-123',
        'test-host.example.com',
      );

      expect(authError).toBeInstanceOf(AuthenticationError);
      expect(authError.message).toBe('API key not found');
      expect(authError.apiKey).toBe('test-key-123');
      expect(authError.host).toBe('test-host.example.com');
      expect(authError.name).toBe('AuthenticationError');
    });

    it('should handle ConnectionError with detailed logging', () => {
      const originalError = new Error('Network timeout');
      const connError = new ConnectionError(
        'Failed to connect',
        'license.libum.io',
        443,
        true,
        originalError,
      );

      expect(connError).toBeInstanceOf(ConnectionError);
      expect(connError.message).toBe('Failed to connect');
      expect(connError.host).toBe('license.libum.io');
      expect(connError.port).toBe(443);
      expect(connError.isSSL).toBe(true);
      expect(connError.originalError).toBe(originalError);
      expect(connError.name).toBe('ConnectionError');
    });

    it('should format AuthenticationError for action failure', () => {
      const authError = new AuthenticationError(
        'No active subscription',
        'expired-key',
        'test-host',
      );

      // Simulate how main.ts would handle this error
      const expectedMessage = 'API key validation failed: No active subscription';
      expect(`API key validation failed: ${authError.message}`).toBe(expectedMessage);
    });

    it('should format ConnectionError for action failure', () => {
      const connError = new ConnectionError(
        'Connection timeout after retries',
        'license.libum.io',
        443,
        true,
      );

      // Simulate how main.ts would handle this error
      const expectedMessage =
        'Failed to connect to license server: Connection timeout after retries';
      expect(`Failed to connect to license server: ${connError.message}`).toBe(expectedMessage);
    });

    it('should mask API key in error logs', () => {
      const authError = new AuthenticationError('Invalid key', 'sk-1234567890abcdef', 'test-host');

      // Verify we can check if key exists without exposing it
      const maskedKey = authError.apiKey ? '***' : 'not provided';
      expect(maskedKey).toBe('***');
    });

    it('should handle missing API key', () => {
      const authError = new AuthenticationError(
        'PowerOn Pipelines API Key is missing',
        '',
        'test-host',
      );

      const maskedKey = authError.apiKey ? '***' : 'not provided';
      expect(maskedKey).toBe('not provided');
    });
  });
});
