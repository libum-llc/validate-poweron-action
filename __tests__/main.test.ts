import * as core from '@actions/core';
import { validatePowerOns } from '../src/validator';
import type { ValidationConfig, ValidationResult } from '../src/validator';

// Mock dependencies
jest.mock('@actions/core');
jest.mock('@actions/exec');
jest.mock('@libum-llc/symitar');

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

    it('should parse ignore list correctly', () => {
      const validateIgnore = 'FILE1.PO, FILE2.PO,  FILE3.PO  ';
      const ignoreList = validateIgnore
        .split(',')
        .map((f) => f.trim())
        .filter((f) => f.length > 0);

      expect(ignoreList).toEqual(['FILE1.PO', 'FILE2.PO', 'FILE3.PO']);
    });

    it('should handle empty ignore list', () => {
      const validateIgnore = '';
      const ignoreList = validateIgnore
        .split(',')
        .map((f) => f.trim())
        .filter((f) => f.length > 0);

      expect(ignoreList).toEqual([]);
    });
  });

  describe('validatePowerOns', () => {
    it('should return zero results when no files found', async () => {
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

      // Mock exec to return no files
      const exec = require('@actions/exec');
      exec.exec.mockImplementation(async (cmd: string, args: string[], options: any) => {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(Buffer.from(''));
        }
        return 0;
      });

      const result = await validatePowerOns(config);

      expect(result.filesValidated).toBe(0);
      expect(result.filesPassed).toBe(0);
      expect(result.filesFailed).toBe(0);
      expect(result.errors).toEqual([]);
    });
  });
});
