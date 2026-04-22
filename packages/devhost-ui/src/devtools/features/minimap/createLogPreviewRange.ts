export interface ILogPreviewRange {
  endIndex: number;
  startIndex: number;
}

const defaultMaximumVisibleRows: number = 21;

export function createLogPreviewRange(
  totalEntries: number,
  entryIndex: number,
  maximumVisibleRows: number = defaultMaximumVisibleRows,
): ILogPreviewRange | null {
  if (totalEntries <= 0 || entryIndex < 0 || entryIndex >= totalEntries) {
    return null;
  }

  const resolvedMaximumVisibleRows: number = Math.max(1, Math.floor(maximumVisibleRows));
  const precedingRowCount: number = Math.floor((resolvedMaximumVisibleRows - 1) / 2);
  const startIndex: number = Math.max(0, entryIndex - precedingRowCount);
  const endIndex: number = Math.min(totalEntries, startIndex + resolvedMaximumVisibleRows);
  const adjustedStartIndex: number = Math.max(0, endIndex - resolvedMaximumVisibleRows);

  return {
    endIndex,
    startIndex: adjustedStartIndex,
  };
}
