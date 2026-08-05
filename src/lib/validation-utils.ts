import * as path from 'path';

import { getSkipReasonForFile } from '@libum-llc/symitar';

import { ChangedFile } from './types';
import { TARGET_BRANCH_PATTERN } from './constants';

/**
 * Result from validating a single PowerOn file
 */
export interface ValidationResult {
  file: ChangedFile;
  isValid: boolean;
  errors: string[];
}

/**
 * Invalid PowerOn with formatted error information
 */
export interface InvalidPowerOn {
  name: string;
  errors: string;
}

/**
 * Determines the validation mode based on branch context
 */
export type ValidationMode = 'git-diff' | 'hash-comparison' | 'none';

/**
 * Skipped file with reason for skipping
 * Reason is a human-readable string from the symitar library or local checks
 */
export interface SkippedFile {
  filePath: string;
  reason: string;
}

/**
 * Result of filtering changed files with detailed skip information
 */
export interface FilterResult {
  filesToValidate: ChangedFile[];
  skippedFiles: SkippedFile[];
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function patternToRegExp(pattern: string): RegExp {
  const source = pattern
    .split('*')
    .map((part) => part.split('?').map(escapeRegExp).join('.'))
    .join('.*');

  return new RegExp(`^${source}$`, 'i');
}

function matchesAnyPattern(fileName: string, patterns: string[] = []): boolean {
  return patterns.some((pattern) => patternToRegExp(pattern).test(fileName));
}

/**
 * Filters changed files and returns detailed information about what was skipped
 * Uses the symitar library's getSkipReasonForFile for PowerOn-specific checks
 *
 * Checks:
 * 1. Deleted files (git status)
 * 2. Ignored files (from config)
 * 3. PowerOn validity via symitar (extension + content checks)
 */
export async function filterChangedFilesWithReport(
  files: ChangedFile[],
  ignoreList: string[],
  preserveServerFiles: string[] = [],
  baseDirectory?: string,
): Promise<FilterResult> {
  const skippedFiles: SkippedFile[] = [];
  const filesToValidate: ChangedFile[] = [];

  for (const file of files) {
    // Check if deleted
    if (file.status === 'deleted') {
      skippedFiles.push({ filePath: file.filePath, reason: 'deleted' });
      continue;
    }

    // Check if ignored
    if (ignoreList.includes(path.basename(file.filePath))) {
      skippedFiles.push({ filePath: file.filePath, reason: 'in ignore list' });
      continue;
    }

    if (matchesAnyPattern(path.basename(file.filePath), preserveServerFiles)) {
      skippedFiles.push({
        filePath: file.filePath,
        reason: 'preserved from server',
      });
      continue;
    }

    // Use symitar library to check if file should be validated
    const fullPath = baseDirectory
      ? path.join(baseDirectory, file.filePath)
      : file.filePath;
    const skipReason = await getSkipReasonForFile(fullPath);

    if (skipReason) {
      skippedFiles.push({ filePath: file.filePath, reason: skipReason });
    } else {
      filesToValidate.push(file);
    }
  }

  return { filesToValidate, skippedFiles };
}

/**
 * Maps deployed file names to ChangedFile objects
 * Used when getting changed files via hash comparison from Symitar
 */
export function mapDeployedToChangedFiles(
  deployed: string[],
  directory: string,
): ChangedFile[] {
  return deployed.map((name) => ({
    filePath: `${directory}${name}`,
    status: 'modified' as const,
  }));
}

/**
 * Collects invalid PowerOns from validation results
 * Filters to only invalid results and formats the output
 */
export function collectInvalidPowerOns(
  results: ValidationResult[],
  directory: string,
): InvalidPowerOn[] {
  return results
    .filter((result) => !result.isValid)
    .map((result) => ({
      name: result.file.filePath.replace(directory, ''),
      errors: result.errors.join('\n'),
    }));
}

/**
 * Determines which validation mode to use based on branch context
 * - 'git-diff': Use git diff when in PR context (targetBranch is set)
 * - 'hash-comparison': Use hash comparison when in build context (buildBranch is set)
 * - 'none': No valid branch context found
 */
export function determineValidationMode(
  targetBranch: string | undefined,
  buildBranch: string | undefined,
): ValidationMode {
  if (targetBranch && TARGET_BRANCH_PATTERN.test(targetBranch)) {
    return 'git-diff';
  }
  if (buildBranch && TARGET_BRANCH_PATTERN.test(buildBranch)) {
    return 'hash-comparison';
  }
  return 'none';
}

/**
 * Normalizes validation errors to always be an array
 * Handles both string and string[] error formats from the Symitar client
 */
export function normalizeValidationErrors(errors: string | string[]): string[] {
  return Array.isArray(errors) ? errors : [errors];
}

/**
 * Formats validation errors for Azure Pipelines summary
 * Flattens all errors with file names prefixed
 */
export function formatErrorsForSummary(
  invalidPowerOns: InvalidPowerOn[],
): string[] {
  return invalidPowerOns.flatMap((po) =>
    po.errors.split('\n').map((err) => `${po.name}: ${err}`),
  );
}

/**
 * Calculates validation statistics from results
 */
export function calculateValidationStats(
  totalFiles: number,
  invalidCount: number,
): {
  filesValidated: number;
  filesPassed: number;
  filesFailed: number;
} {
  return {
    filesValidated: totalFiles,
    filesPassed: totalFiles - invalidCount,
    filesFailed: invalidCount,
  };
}
