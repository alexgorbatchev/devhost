import { createLogPreviewRange } from "./createLogPreviewRange";
import type { ServiceLogEntry } from "./types";

export function createLogPreviewWindow(entries: ServiceLogEntry[], entryIndex: number): ServiceLogEntry[] {
  const previewRange = createLogPreviewRange(entries.length, entryIndex);

  if (previewRange === null) {
    return [];
  }

  return entries.slice(previewRange.startIndex, previewRange.endIndex);
}
