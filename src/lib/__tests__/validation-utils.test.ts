import * as path from 'path';

import { ChangedFile } from '../types';
import {
  filterChangedFilesWithReport,
  mapDeployedToChangedFiles,
  collectInvalidPowerOns,
  determineValidationMode,
  normalizeValidationErrors,
  formatErrorsForSummary,
  calculateValidationStats,
  ValidationResult,
  InvalidPowerOn,
} from '../validation-utils';

// Mock the symitar library
jest.mock('@libum-llc/symitar', () => ({
  getSkipReasonForFile: jest.fn(),
}));

import { getSkipReasonForFile } from '@libum-llc/symitar';

const mockedGetSkipReasonForFile = getSkipReasonForFile as jest.MockedFunction<
  typeof getSkipReasonForFile
>;

describe('validation-utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('filterChangedFilesWithReport', () => {
    it('should return files to validate and skipped files with reasons', async () => {
      // Mock responses for each file
      mockedGetSkipReasonForFile.mockImplementation(
        async (filePath: string) => {
          if (filePath.endsWith('.PO') || filePath.endsWith('.RG')) {
            return null; // Valid PowerOn
          }
          if (filePath.endsWith('.PRO')) {
            return 'File extension (.PRO) is used as #INCLUDE file and should not be validated as standalone.';
          }
          return 'Missing required TARGET and PRINT TITLE divisions.';
        },
      );

      const files: ChangedFile[] = [
        { filePath: 'REPWRITERSPECS/FILE1.PO', status: 'modified' },
        { filePath: 'REPWRITERSPECS/FILE2.PO', status: 'deleted' },
        { filePath: 'REPWRITERSPECS/IGNORE.PO', status: 'modified' },
        { filePath: 'REPWRITERSPECS/README.md', status: 'modified' },
        { filePath: 'REPWRITERSPECS/FILE3.PRO', status: 'modified' },
        { filePath: 'REPWRITERSPECS/FILE4.RG', status: 'added' },
      ];

      const result = await filterChangedFilesWithReport(files, ['IGNORE.PO']);

      expect(result.filesToValidate).toHaveLength(2);
      expect(result.filesToValidate.map((f) => f.filePath)).toEqual([
        'REPWRITERSPECS/FILE1.PO',
        'REPWRITERSPECS/FILE4.RG',
      ]);

      expect(result.skippedFiles).toHaveLength(4);
      expect(result.skippedFiles).toContainEqual({
        filePath: 'REPWRITERSPECS/FILE2.PO',
        reason: 'deleted',
      });
      expect(result.skippedFiles).toContainEqual({
        filePath: 'REPWRITERSPECS/IGNORE.PO',
        reason: 'in ignore list',
      });
      // README.md is skipped by symitar with content-based reason
      expect(
        result.skippedFiles.find(
          (f) => f.filePath === 'REPWRITERSPECS/README.md',
        ),
      ).toBeDefined();
      // FILE3.PRO is skipped by symitar with extension-based reason
      expect(
        result.skippedFiles.find(
          (f) => f.filePath === 'REPWRITERSPECS/FILE3.PRO',
        ),
      ).toBeDefined();
    });

    it('should return empty skippedFiles when all files are validatable', async () => {
      mockedGetSkipReasonForFile.mockResolvedValue(null);

      const files: ChangedFile[] = [
        { filePath: 'REPWRITERSPECS/FILE1.PO', status: 'modified' },
        { filePath: 'REPWRITERSPECS/FILE2.RG', status: 'added' },
      ];

      const result = await filterChangedFilesWithReport(files, []);

      expect(result.filesToValidate).toHaveLength(2);
      expect(result.skippedFiles).toHaveLength(0);
    });

    it('should return empty filesToValidate when all files are skipped', async () => {
      mockedGetSkipReasonForFile.mockResolvedValue(
        'Missing required TARGET and PRINT TITLE divisions.',
      );

      const files: ChangedFile[] = [
        { filePath: 'REPWRITERSPECS/README.md', status: 'modified' },
        { filePath: 'REPWRITERSPECS/config.json', status: 'modified' },
      ];

      const result = await filterChangedFilesWithReport(files, []);

      expect(result.filesToValidate).toHaveLength(0);
      expect(result.skippedFiles).toHaveLength(2);
    });

    it('should handle empty input array', async () => {
      const result = await filterChangedFilesWithReport([], []);

      expect(result.filesToValidate).toHaveLength(0);
      expect(result.skippedFiles).toHaveLength(0);
    });

    it('should validate files without extension if they have valid content', async () => {
      // This simulates files like LB.REDIRECT that don't have .PO extension
      // but have valid PowerOn content (TARGET + PRINT TITLE)
      mockedGetSkipReasonForFile.mockImplementation(
        async (filePath: string) => {
          if (filePath.includes('LB.REDIRECT')) {
            return null; // Has valid content
          }
          return 'Missing required TARGET and PRINT TITLE divisions.';
        },
      );

      const files: ChangedFile[] = [
        { filePath: 'REPWRITERSPECS/LB.REDIRECT', status: 'modified' },
        { filePath: 'REPWRITERSPECS/INVALID.FILE', status: 'modified' },
      ];

      const result = await filterChangedFilesWithReport(files, []);

      expect(result.filesToValidate).toHaveLength(1);
      expect(result.filesToValidate[0].filePath).toBe(
        'REPWRITERSPECS/LB.REDIRECT',
      );
      expect(result.skippedFiles).toHaveLength(1);
    });

    it('should skip RD and PFR files preserved from the server', async () => {
      mockedGetSkipReasonForFile.mockResolvedValue(null);

      const files: ChangedFile[] = [
        { filePath: 'REPWRITERSPECS/FILE1.PO', status: 'modified' },
        { filePath: 'REPWRITERSPECS/RD.ACCOUNT.DEFAULTS', status: 'modified' },
        { filePath: 'REPWRITERSPECS/PFR.SYSTEM.DEFAULTS', status: 'modified' },
      ];

      const result = await filterChangedFilesWithReport(
        files,
        [],
        ['RD.*', 'PFR.*'],
      );

      expect(result.filesToValidate.map((file) => file.filePath)).toEqual([
        'REPWRITERSPECS/FILE1.PO',
      ]);
      expect(result.skippedFiles).toContainEqual({
        filePath: 'REPWRITERSPECS/RD.ACCOUNT.DEFAULTS',
        reason: 'preserved from server',
      });
      expect(result.skippedFiles).toContainEqual({
        filePath: 'REPWRITERSPECS/PFR.SYSTEM.DEFAULTS',
        reason: 'preserved from server',
      });
      expect(mockedGetSkipReasonForFile).toHaveBeenCalledTimes(1);
    });

    it('should match preserve server file patterns case-insensitively with ? wildcard', async () => {
      mockedGetSkipReasonForFile.mockResolvedValue(null);

      const files: ChangedFile[] = [
        { filePath: 'REPWRITERSPECS/rd.ACCOUNT.DEFAULTS', status: 'modified' },
        { filePath: 'REPWRITERSPECS/PFR1.DEFAULTS', status: 'modified' },
        { filePath: 'REPWRITERSPECS/PFR12.DEFAULTS', status: 'modified' },
      ];

      const result = await filterChangedFilesWithReport(
        files,
        [],
        ['RD.*', 'PFR?.DEFAULTS'],
      );

      expect(result.filesToValidate.map((file) => file.filePath)).toEqual([
        'REPWRITERSPECS/PFR12.DEFAULTS',
      ]);
      expect(result.skippedFiles).toContainEqual({
        filePath: 'REPWRITERSPECS/rd.ACCOUNT.DEFAULTS',
        reason: 'preserved from server',
      });
      expect(result.skippedFiles).toContainEqual({
        filePath: 'REPWRITERSPECS/PFR1.DEFAULTS',
        reason: 'preserved from server',
      });
      expect(mockedGetSkipReasonForFile).toHaveBeenCalledTimes(1);
    });

    it('should use baseDirectory when provided', async () => {
      mockedGetSkipReasonForFile.mockResolvedValue(null);

      const files: ChangedFile[] = [
        { filePath: 'REPWRITERSPECS/FILE1.PO', status: 'modified' },
      ];

      await filterChangedFilesWithReport(files, [], [], '/artifact/path');

      // The function should construct the full path using baseDirectory
      expect(mockedGetSkipReasonForFile).toHaveBeenCalledWith(
        path.join('/artifact/path', 'REPWRITERSPECS/FILE1.PO'),
      );
    });

    it('should work with hash-comparison flow (mapDeployedToChangedFiles output)', async () => {
      mockedGetSkipReasonForFile.mockImplementation(
        async (filePath: string) => {
          if (filePath.endsWith('.PO') || filePath.endsWith('.RG')) {
            return null;
          }
          if (filePath.endsWith('.PRO') || filePath.endsWith('.DEF')) {
            return 'File extension is used as #INCLUDE file and should not be validated as standalone.';
          }
          return 'Missing required TARGET and PRINT TITLE divisions.';
        },
      );

      // Simulate getChangedFiles returning a mix of files from Symitar
      const deployed = [
        'FILE1.PO',
        'FILE2.PRO',
        'README.md',
        'config.json',
        'FILE3.RG',
        'FILE4.DEF',
      ];
      const rawChangedFiles = mapDeployedToChangedFiles(
        deployed,
        'REPWRITERSPECS/',
      );

      const result = await filterChangedFilesWithReport(rawChangedFiles, []);

      // Only .PO and .RG should be validated
      expect(result.filesToValidate).toHaveLength(2);
      expect(result.filesToValidate.map((f) => f.filePath)).toEqual([
        'REPWRITERSPECS/FILE1.PO',
        'REPWRITERSPECS/FILE3.RG',
      ]);

      // Others should be skipped
      expect(result.skippedFiles).toHaveLength(4);
    });
  });

  describe('mapDeployedToChangedFiles', () => {
    it('should map deployed names to ChangedFile objects', () => {
      const deployed = ['FILE1.PO', 'FILE2.PO'];

      const result = mapDeployedToChangedFiles(deployed, 'REPWRITERSPECS/');

      expect(result).toHaveLength(2);
      expect(result).toEqual([
        { filePath: 'REPWRITERSPECS/FILE1.PO', status: 'modified' },
        { filePath: 'REPWRITERSPECS/FILE2.PO', status: 'modified' },
      ]);
    });

    it('should handle empty array', () => {
      const result = mapDeployedToChangedFiles([], 'REPWRITERSPECS/');

      expect(result).toHaveLength(0);
    });

    it('should use provided directory prefix', () => {
      const deployed = ['FILE.PO'];

      const result = mapDeployedToChangedFiles(deployed, 'CUSTOM/PATH/');

      expect(result[0].filePath).toBe('CUSTOM/PATH/FILE.PO');
    });

    it('should always set status to modified', () => {
      const deployed = ['FILE1.PO', 'FILE2.PO', 'FILE3.PO'];

      const result = mapDeployedToChangedFiles(deployed, 'DIR/');

      expect(result.every((f) => f.status === 'modified')).toBe(true);
    });
  });

  describe('collectInvalidPowerOns', () => {
    it('should collect only invalid results', () => {
      const results: ValidationResult[] = [
        {
          file: { filePath: 'DIR/FILE1.PO', status: 'modified' },
          isValid: true,
          errors: [],
        },
        {
          file: { filePath: 'DIR/FILE2.PO', status: 'modified' },
          isValid: false,
          errors: ['Syntax error on line 1'],
        },
        {
          file: { filePath: 'DIR/FILE3.PO', status: 'modified' },
          isValid: true,
          errors: [],
        },
      ];

      const result = collectInvalidPowerOns(results, 'DIR/');

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        name: 'FILE2.PO',
        errors: 'Syntax error on line 1',
      });
    });

    it('should join multiple errors with newlines', () => {
      const results: ValidationResult[] = [
        {
          file: { filePath: 'DIR/FILE.PO', status: 'modified' },
          isValid: false,
          errors: ['Error 1', 'Error 2', 'Error 3'],
        },
      ];

      const result = collectInvalidPowerOns(results, 'DIR/');

      expect(result[0].errors).toBe('Error 1\nError 2\nError 3');
    });

    it('should strip directory from file name', () => {
      const results: ValidationResult[] = [
        {
          file: {
            filePath: 'REPWRITERSPECS/SUBDIR/FILE.PO',
            status: 'modified',
          },
          isValid: false,
          errors: ['Error'],
        },
      ];

      const result = collectInvalidPowerOns(results, 'REPWRITERSPECS/');

      expect(result[0].name).toBe('SUBDIR/FILE.PO');
    });

    it('should return empty array when all valid', () => {
      const results: ValidationResult[] = [
        {
          file: { filePath: 'DIR/FILE1.PO', status: 'modified' },
          isValid: true,
          errors: [],
        },
        {
          file: { filePath: 'DIR/FILE2.PO', status: 'modified' },
          isValid: true,
          errors: [],
        },
      ];

      const result = collectInvalidPowerOns(results, 'DIR/');

      expect(result).toHaveLength(0);
    });

    it('should handle empty results array', () => {
      const result = collectInvalidPowerOns([], 'DIR/');

      expect(result).toHaveLength(0);
    });
  });

  describe('determineValidationMode', () => {
    it('should return git-diff when targetBranch matches pattern', () => {
      const result = determineValidationMode('refs/heads/main', undefined);

      expect(result).toBe('git-diff');
    });

    it('should return git-diff for feature branches', () => {
      const result = determineValidationMode(
        'refs/heads/feature/my-feature',
        undefined,
      );

      expect(result).toBe('git-diff');
    });

    it('should return hash-comparison when only buildBranch matches', () => {
      const result = determineValidationMode(undefined, 'refs/heads/main');

      expect(result).toBe('hash-comparison');
    });

    it('should prefer git-diff over hash-comparison', () => {
      const result = determineValidationMode(
        'refs/heads/develop',
        'refs/heads/main',
      );

      expect(result).toBe('git-diff');
    });

    it('should return none when no branches match', () => {
      const result = determineValidationMode(undefined, undefined);

      expect(result).toBe('none');
    });

    it('should return none for invalid branch patterns', () => {
      const result = determineValidationMode('main', 'develop');

      expect(result).toBe('none');
    });

    it('should return none for empty strings', () => {
      const result = determineValidationMode('', '');

      expect(result).toBe('none');
    });

    it('should handle refs/tags/ (not matching pattern)', () => {
      const result = determineValidationMode('refs/tags/v1.0.0', undefined);

      expect(result).toBe('none');
    });
  });

  describe('normalizeValidationErrors', () => {
    it('should return array as-is', () => {
      const errors = ['Error 1', 'Error 2'];

      const result = normalizeValidationErrors(errors);

      expect(result).toEqual(['Error 1', 'Error 2']);
    });

    it('should wrap string in array', () => {
      const result = normalizeValidationErrors('Single error');

      expect(result).toEqual(['Single error']);
    });

    it('should handle empty array', () => {
      const result = normalizeValidationErrors([]);

      expect(result).toEqual([]);
    });

    it('should handle empty string', () => {
      const result = normalizeValidationErrors('');

      expect(result).toEqual(['']);
    });
  });

  describe('formatErrorsForSummary', () => {
    it('should format single error per file', () => {
      const invalidPowerOns: InvalidPowerOn[] = [
        { name: 'FILE1.PO', errors: 'Syntax error' },
        { name: 'FILE2.PO', errors: 'Missing variable' },
      ];

      const result = formatErrorsForSummary(invalidPowerOns);

      expect(result).toEqual([
        'FILE1.PO: Syntax error',
        'FILE2.PO: Missing variable',
      ]);
    });

    it('should split multi-line errors', () => {
      const invalidPowerOns: InvalidPowerOn[] = [
        { name: 'FILE.PO', errors: 'Error 1\nError 2\nError 3' },
      ];

      const result = formatErrorsForSummary(invalidPowerOns);

      expect(result).toEqual([
        'FILE.PO: Error 1',
        'FILE.PO: Error 2',
        'FILE.PO: Error 3',
      ]);
    });

    it('should handle mixed single and multi-line errors', () => {
      const invalidPowerOns: InvalidPowerOn[] = [
        { name: 'FILE1.PO', errors: 'Single error' },
        { name: 'FILE2.PO', errors: 'Error A\nError B' },
      ];

      const result = formatErrorsForSummary(invalidPowerOns);

      expect(result).toEqual([
        'FILE1.PO: Single error',
        'FILE2.PO: Error A',
        'FILE2.PO: Error B',
      ]);
    });

    it('should handle empty array', () => {
      const result = formatErrorsForSummary([]);

      expect(result).toEqual([]);
    });
  });

  describe('calculateValidationStats', () => {
    it('should calculate stats correctly', () => {
      const result = calculateValidationStats(10, 3);

      expect(result).toEqual({
        filesValidated: 10,
        filesPassed: 7,
        filesFailed: 3,
      });
    });

    it('should handle all files passing', () => {
      const result = calculateValidationStats(5, 0);

      expect(result).toEqual({
        filesValidated: 5,
        filesPassed: 5,
        filesFailed: 0,
      });
    });

    it('should handle all files failing', () => {
      const result = calculateValidationStats(5, 5);

      expect(result).toEqual({
        filesValidated: 5,
        filesPassed: 0,
        filesFailed: 5,
      });
    });

    it('should handle zero files', () => {
      const result = calculateValidationStats(0, 0);

      expect(result).toEqual({
        filesValidated: 0,
        filesPassed: 0,
        filesFailed: 0,
      });
    });
  });
});
