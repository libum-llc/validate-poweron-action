import {
  findUnpreservedServerManagedFiles,
  formatServerManagedFilesWarning,
} from '../server-managed-files';

describe('server-managed-files', () => {
  it('finds all typically Symitar-managed filename patterns', () => {
    expect(
      findUnpreservedServerManagedFiles([
        'REPWRITERSPECS/RB.SYSTEM',
        'RD.ACCOUNT.DEFAULTS',
        'nested/PFR.SYSTEM.DEFAULTS',
        'SYC.SYSTEM',
        'LETTER.poas',
        'NORMAL.PO',
      ]),
    ).toEqual([
      'REPWRITERSPECS/RB.SYSTEM',
      'RD.ACCOUNT.DEFAULTS',
      'nested/PFR.SYSTEM.DEFAULTS',
    ]);
  });

  it('does not warn for files already covered by preserveServerFiles', () => {
    expect(
      findUnpreservedServerManagedFiles(
        ['RB.SYSTEM', 'RD.DEFAULTS', 'PFR.DEFAULTS'],
        ['RB.*', 'rd.defaults', 'pfr.*'],
      ),
    ).toEqual([]);
  });

  it('deduplicates files and formats an actionable warning', () => {
    const files = findUnpreservedServerManagedFiles([
      'RD.DEFAULTS',
      'RD.DEFAULTS',
    ]);
    const warning = formatServerManagedFilesWarning(files);

    expect(files).toEqual(['RD.DEFAULTS']);
    expect(warning).toContain('⚠️ ACTION REQUIRED');
    expect(warning).toContain('preserveServerFiles');
    expect(warning).toContain('RD.DEFAULTS');
  });
});
