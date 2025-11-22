import * as core from '@actions/core';
import * as exec from '@actions/exec';
import { validatePowerOns } from '../src/validator';
import type { ValidationConfig } from '../src/validator';
import { SymitarHTTPs, SymitarSSH } from '@libum-llc/symitar';

jest.mock('@actions/core');
jest.mock('@actions/exec');
jest.mock('@libum-llc/symitar');

describe('validator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const baseConfig: ValidationConfig = {
    symitarHostname: 'test.symitar.example.com',
    symNumber: '001',
    symitarUserNumber: '1234',
    symitarUserPassword: 'password',
    sshUsername: 'sshuser',
    sshPassword: 'sshpass',
    sshPort: 22,
    apiKey: 'test-api-key',
    connectionType: 'ssh',
    poweronDirectory: 'REPWRITERSPECS/',
    ignoreList: [],
    logPrefix: '[Test]',
  };

  describe('getChangedFiles - no target branch', () => {
    it('should find all .PO files in directory when no target branch specified', async () => {
      const mockExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
      mockExec.mockImplementation(async (cmd, args, options) => {
        if (cmd === 'find' && options?.listeners?.stdout) {
          const files = 'REPWRITERSPECS/FILE1.PO\nREPWRITERSPECS/FILE2.PO\n';
          options.listeners.stdout(Buffer.from(files));
        }
        return 0;
      });

      const result = await validatePowerOns(baseConfig);

      expect(mockExec).toHaveBeenCalledWith(
        'find',
        ['REPWRITERSPECS/', '-type', 'f', '-name', '*.PO'],
        expect.any(Object),
      );
      expect(result.filesValidated).toBe(2);
    });

    it('should filter out ignored files when no target branch specified', async () => {
      const mockExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
      mockExec.mockImplementation(async (cmd, args, options) => {
        if (cmd === 'find' && options?.listeners?.stdout) {
          const files = 'REPWRITERSPECS/FILE1.PO\nREPWRITERSPECS/IGNORE.PO\n';
          options.listeners.stdout(Buffer.from(files));
        }
        return 0;
      });

      const config = { ...baseConfig, ignoreList: ['IGNORE.PO'] };
      const result = await validatePowerOns(config);

      expect(result.filesValidated).toBe(1);
    });
  });

  describe('getChangedFiles - with target branch', () => {
    it('should get changed files from git diff when target branch specified', async () => {
      const mockExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
      mockExec.mockImplementation(async (cmd, args, options) => {
        if (cmd === 'git' && options?.listeners?.stdout) {
          const gitOutput = 'M\tREPWRITERSPECS/FILE1.PO\nA\tREPWRITERSPECS/FILE2.PO\n';
          options.listeners.stdout(Buffer.from(gitOutput));
        }
        return 0;
      });

      const config = { ...baseConfig, targetBranch: 'origin/main' };
      const result = await validatePowerOns(config);

      expect(mockExec).toHaveBeenCalledWith(
        'git',
        ['diff', '--name-status', 'origin/main', '--', 'REPWRITERSPECS/'],
        expect.any(Object),
      );
      expect(result.filesValidated).toBe(2);
    });

    it('should skip deleted files when using target branch', async () => {
      const mockExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
      mockExec.mockImplementation(async (cmd, args, options) => {
        if (cmd === 'git' && options?.listeners?.stdout) {
          const gitOutput = 'M\tREPWRITERSPECS/FILE1.PO\nD\tREPWRITERSPECS/DELETED.PO\n';
          options.listeners.stdout(Buffer.from(gitOutput));
        }
        return 0;
      });

      const config = { ...baseConfig, targetBranch: 'origin/main' };
      const result = await validatePowerOns(config);

      expect(result.filesValidated).toBe(1);
    });

    it('should filter ignored files when using target branch', async () => {
      const mockExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
      mockExec.mockImplementation(async (cmd, args, options) => {
        if (cmd === 'git' && options?.listeners?.stdout) {
          const gitOutput = 'M\tREPWRITERSPECS/FILE1.PO\nM\tREPWRITERSPECS/IGNORE.PO\n';
          options.listeners.stdout(Buffer.from(gitOutput));
        }
        return 0;
      });

      const config = { ...baseConfig, targetBranch: 'origin/main', ignoreList: ['IGNORE.PO'] };
      const result = await validatePowerOns(config);

      expect(result.filesValidated).toBe(1);
    });
  });

  describe('validateWithSSH', () => {
    it('should create SSH client and validate files', async () => {
      const mockExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
      mockExec.mockImplementation(async (cmd, args, options) => {
        if (cmd === 'find' && options?.listeners?.stdout) {
          options.listeners.stdout(Buffer.from('REPWRITERSPECS/TEST.PO\n'));
        }
        return 0;
      });

      const mockWorker = {
        validatePowerOn: jest.fn().mockResolvedValue({ isValid: true, errors: [] }),
      };

      const mockSSHClient = {
        isReady: Promise.resolve(),
        createValidateWorker: jest.fn().mockResolvedValue(mockWorker),
        end: jest.fn().mockResolvedValue(undefined),
      };

      (SymitarSSH as jest.MockedClass<typeof SymitarSSH>).mockImplementation(
        () => mockSSHClient as any,
      );

      const result = await validatePowerOns(baseConfig);

      expect(SymitarSSH).toHaveBeenCalledWith({
        host: 'test.symitar.example.com',
        port: 22,
        username: 'sshuser',
        password: 'sshpass',
      });
      expect(mockSSHClient.createValidateWorker).toHaveBeenCalledWith({
        symNumber: 1,
        symitarUserNumber: '1234',
        symitarUserPassword: 'password',
        apiKey: 'test-api-key',
      });
      expect(mockWorker.validatePowerOn).toHaveBeenCalledWith('REPWRITERSPECS/TEST.PO');
      expect(mockSSHClient.end).toHaveBeenCalled();
      expect(result.filesPassed).toBe(1);
      expect(result.filesFailed).toBe(0);
    });

    it('should handle validation errors with SSH', async () => {
      const mockExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
      mockExec.mockImplementation(async (cmd, args, options) => {
        if (cmd === 'find' && options?.listeners?.stdout) {
          options.listeners.stdout(Buffer.from('REPWRITERSPECS/INVALID.PO\n'));
        }
        return 0;
      });

      const mockWorker = {
        validatePowerOn: jest
          .fn()
          .mockResolvedValue({ isValid: false, errors: ['Syntax error on line 5'] }),
      };

      const mockSSHClient = {
        isReady: Promise.resolve(),
        createValidateWorker: jest.fn().mockResolvedValue(mockWorker),
        end: jest.fn().mockResolvedValue(undefined),
      };

      (SymitarSSH as jest.MockedClass<typeof SymitarSSH>).mockImplementation(
        () => mockSSHClient as any,
      );

      const result = await validatePowerOns(baseConfig);

      expect(result.filesPassed).toBe(0);
      expect(result.filesFailed).toBe(1);
      expect(result.errors).toContain('INVALID.PO: Syntax error on line 5');
    });
  });

  describe('validateWithHTTPs', () => {
    it('should create HTTPs client and validate files', async () => {
      const mockExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
      mockExec.mockImplementation(async (cmd, args, options) => {
        if (cmd === 'find' && options?.listeners?.stdout) {
          options.listeners.stdout(Buffer.from('REPWRITERSPECS/TEST.PO\n'));
        }
        return 0;
      });

      const mockHTTPsClient = {
        validatePowerOn: jest.fn().mockResolvedValue({ isValid: true, errors: [] }),
        end: jest.fn(),
      };

      (SymitarHTTPs as jest.MockedClass<typeof SymitarHTTPs>).mockImplementation(
        () => mockHTTPsClient as any,
      );

      const config = { ...baseConfig, connectionType: 'https' as const };
      const result = await validatePowerOns(config);

      expect(SymitarHTTPs).toHaveBeenCalledWith(
        'https://test.symitar.example.com',
        {
          symNumber: 1,
          symitarUserNumber: '1234',
          symitarUserPassword: 'password',
          apiKey: 'test-api-key',
        },
        'info',
        {
          host: 'test.symitar.example.com',
          port: 22,
          username: 'sshuser',
          password: 'sshpass',
        },
      );
      expect(mockHTTPsClient.validatePowerOn).toHaveBeenCalledWith('REPWRITERSPECS/TEST.PO');
      expect(mockHTTPsClient.end).toHaveBeenCalled();
      expect(result.filesPassed).toBe(1);
      expect(result.filesFailed).toBe(0);
    });

    it('should handle validation errors with HTTPs', async () => {
      const mockExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
      mockExec.mockImplementation(async (cmd, args, options) => {
        if (cmd === 'find' && options?.listeners?.stdout) {
          options.listeners.stdout(Buffer.from('REPWRITERSPECS/INVALID.PO\n'));
        }
        return 0;
      });

      const mockHTTPsClient = {
        validatePowerOn: jest
          .fn()
          .mockResolvedValue({ isValid: false, errors: ['Invalid command'] }),
        end: jest.fn(),
      };

      (SymitarHTTPs as jest.MockedClass<typeof SymitarHTTPs>).mockImplementation(
        () => mockHTTPsClient as any,
      );

      const config = { ...baseConfig, connectionType: 'https' as const };
      const result = await validatePowerOns(config);

      expect(result.filesPassed).toBe(0);
      expect(result.filesFailed).toBe(1);
      expect(result.errors).toContain('INVALID.PO: Invalid command');
    });
  });

  describe('error handling', () => {
    it('should handle exceptions during validation', async () => {
      const mockExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
      mockExec.mockImplementation(async (cmd, args, options) => {
        if (cmd === 'find' && options?.listeners?.stdout) {
          options.listeners.stdout(Buffer.from('REPWRITERSPECS/TEST.PO\n'));
        }
        return 0;
      });

      const mockWorker = {
        validatePowerOn: jest.fn().mockRejectedValue(new Error('Connection timeout')),
      };

      const mockSSHClient = {
        isReady: Promise.resolve(),
        createValidateWorker: jest.fn().mockResolvedValue(mockWorker),
        end: jest.fn().mockResolvedValue(undefined),
      };

      (SymitarSSH as jest.MockedClass<typeof SymitarSSH>).mockImplementation(
        () => mockSSHClient as any,
      );

      const result = await validatePowerOns(baseConfig);

      expect(result.filesPassed).toBe(0);
      expect(result.filesFailed).toBe(1);
      expect(result.errors).toContain('TEST.PO: Connection timeout');
    });
  });
});
