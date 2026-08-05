import {
  formatChangedFileReason,
  formatComparisonStrategy,
  formatDeletedFileReason,
} from '../change-debug';

describe('change-debug', () => {
  it('describes a missing destination file', () => {
    expect(
      formatChangedFileReason('TEST.PO', 'quick', 'local', 'Sym', 'missing'),
    ).toBe('TEST.PO: considered changed because it is missing from Sym');
  });

  it('describes a normalized byte-size difference', () => {
    expect(
      formatChangedFileReason('TEST.PO', 'quick', 'local', 'Sym', 'different'),
    ).toBe(
      'TEST.PO: considered changed because its normalized byte size differs between local and Sym',
    );
  });

  it('describes a normalized checksum difference', () => {
    expect(
      formatChangedFileReason(
        'TEST.PO',
        'checksum',
        'Sym',
        'local',
        'different',
      ),
    ).toBe(
      'TEST.PO: considered changed because its normalized content checksum differs between Sym and local',
    );
  });

  it('retains a combined fallback when the reason is unavailable', () => {
    expect(formatChangedFileReason('TEST.PO', 'quick', 'local', 'Sym')).toBe(
      'TEST.PO: considered changed because it is missing from Sym or its normalized byte size differs',
    );
  });

  it('describes mirror deletions', () => {
    expect(formatDeletedFileReason('OLD.PO', 'local', 'Sym')).toBe(
      'OLD.PO: considered deleted because it exists in Sym but is missing from local',
    );
  });

  it('describes the active comparison strategy', () => {
    expect(formatComparisonStrategy('sftp', 'quick')).toBe(
      'Change detection strategy: SFTP quick comparison (file presence and normalized byte size; timestamps and content hashes are not compared)',
    );
  });
});
