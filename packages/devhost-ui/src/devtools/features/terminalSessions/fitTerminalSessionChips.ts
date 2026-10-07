import type { ITerminalSessionChipFailedFit, ITerminalSessionChipFit, ITerminalSessionChipMeasurement } from "./types";

/**
 * Decides how many session chips the toolbar shows next, one chip at a time: a chip folds while the content is
 * wider than the room, and a folded chip comes back when it can fit. The caller measures again after applying the
 * answer and stops when the answer is the count it already shows.
 *
 * Bringing a chip back narrows the "+N" control by an amount that is not known in advance, at most all of it, and
 * measured widths are rounded. So a chip that can fit may still overflow once laid out; it then folds again, and
 * `failedFit` keeps that count from being tried until the room grows or the chips change.
 */
export function fitTerminalSessionChips(
  measurement: ITerminalSessionChipMeasurement,
  failedFit: ITerminalSessionChipFailedFit | null,
): ITerminalSessionChipFit {
  const { contentWidth, fitKey, gapWidth, hiddenCount, nextChipWidth, overflowWidth, room, visibleCount } = measurement;

  if (contentWidth > room) {
    if (visibleCount === 0) {
      return { failedFit, visibleLimit: 0 };
    }

    return { failedFit: { fitKey, room, visibleLimit: visibleCount }, visibleLimit: visibleCount - 1 };
  }

  const nextVisibleLimit: number = visibleCount + 1;
  const hasFailedBefore: boolean =
    failedFit !== null &&
    failedFit.fitKey === fitKey &&
    nextVisibleLimit >= failedFit.visibleLimit &&
    room <= failedFit.room;

  if (nextChipWidth === null || hasFailedBefore) {
    return { failedFit, visibleLimit: visibleCount };
  }

  // The last folded chip takes the place of the control; any other one sits beside it.
  const addedGapWidth: number = hiddenCount === 1 ? 0 : gapWidth;
  const canFit: boolean = contentWidth + nextChipWidth + addedGapWidth - overflowWidth <= room;

  return { failedFit, visibleLimit: canFit ? nextVisibleLimit : visibleCount };
}
