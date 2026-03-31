export interface ILogPreviewRange {
  endIndex: number;
  startIndex: number;
}

const previewContextRadius: number = 10;

export function createLogPreviewRange(totalEntries: number, entryIndex: number): ILogPreviewRange | null {
  if (totalEntries <= 0 || entryIndex < 0 || entryIndex >= totalEntries) {
    return null;
  }

  return {
    endIndex: Math.min(totalEntries, entryIndex + previewContextRadius + 1),
    startIndex: Math.max(0, entryIndex - previewContextRadius),
  };
}
