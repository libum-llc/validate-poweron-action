import type { SymitarSyncCompareMode } from '@libum-llc/symitar';

export type ChangedFileReason = 'missing' | 'different';

export function formatChangedFileReason(
  fileName: string,
  compareMode: SymitarSyncCompareMode,
  source: string,
  destination: string,
  reason?: ChangedFileReason,
): string {
  if (reason === 'missing') {
    return `${fileName}: considered changed because it is missing from ${destination}`;
  }

  const criterion =
    compareMode === 'checksum'
      ? 'normalized content checksum'
      : 'normalized byte size';

  if (reason === 'different') {
    return `${fileName}: considered changed because its ${criterion} differs between ${source} and ${destination}`;
  }

  return `${fileName}: considered changed because it is missing from ${destination} or its ${criterion} differs`;
}

export function formatDeletedFileReason(
  fileName: string,
  source: string,
  destination: string,
): string {
  return `${fileName}: considered deleted because it exists in ${destination} but is missing from ${source}`;
}

export function formatComparisonStrategy(
  transport: string,
  compareMode: SymitarSyncCompareMode,
): string {
  const criteria =
    compareMode === 'checksum'
      ? 'file presence and normalized content checksum'
      : 'file presence and normalized byte size; timestamps and content hashes are not compared';

  return `Change detection strategy: ${transport.toUpperCase()} ${compareMode} comparison (${criteria})`;
}
