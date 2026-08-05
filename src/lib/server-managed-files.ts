const TYPICALLY_SERVER_MANAGED_PATTERNS = ['RB.*', 'RD.*', 'PFR.*'] as const;

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

function basename(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath;
}

function matchesAnyPattern(
  fileName: string,
  patterns: readonly string[],
): boolean {
  return patterns.some((pattern) => patternToRegExp(pattern).test(fileName));
}

/** Finds commonly Symitar-managed files not covered by preserveServerFiles. */
export function findUnpreservedServerManagedFiles(
  filePaths: string[],
  preserveServerFiles: string[] = [],
): string[] {
  return [...new Set(filePaths)].filter((filePath) => {
    const fileName = basename(filePath);
    return (
      matchesAnyPattern(fileName, TYPICALLY_SERVER_MANAGED_PATTERNS) &&
      !matchesAnyPattern(fileName, preserveServerFiles)
    );
  });
}

export function formatServerManagedFilesWarning(filePaths: string[]): string {
  return (
    `⚠️ ACTION REQUIRED: ${filePaths.length} potentially Symitar-managed file(s) ` +
    `are being considered for change: ${filePaths.join(', ')}. ` +
    'These files may change on the server during a release outside the repository. ' +
    'Review them and consider adding RB.*, RD.*, and/or PFR.* to ' +
    'preserveServerFiles before continuing.'
  );
}
