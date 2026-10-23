import type { CaptureFrameCheck } from "./types";

/** Compare only hidden surfaces, so animation elsewhere cannot release a queued capture frame. */
export function createChangedRegionCheck(
  context: CanvasRenderingContext2D,
  before: ImageData,
  regions: readonly DOMRectReadOnly[],
  viewportWidth: number,
  viewportHeight: number,
): CaptureFrameCheck {
  const samples = regions.flatMap((region) => {
    if (region.width <= 0 || region.height <= 0) return [];
    const x = Math.max(0, Math.floor((region.x * before.width) / viewportWidth));
    const y = Math.max(0, Math.floor((region.y * before.height) / viewportHeight));
    const right = Math.min(before.width, Math.ceil((region.right * before.width) / viewportWidth));
    const bottom = Math.min(before.height, Math.ceil((region.bottom * before.height) / viewportHeight));
    return right > x && bottom > y ? [{ x, y, width: right - x, height: bottom - y }] : [];
  });
  return () =>
    samples.every((region) => {
      const current = context.getImageData(region.x, region.y, region.width, region.height);
      let changedPixels = 0;
      for (let y = 0; y < region.height; y += 1) {
        for (let x = 0; x < region.width; x += 1) {
          const previousOffset = ((region.y + y) * before.width + region.x + x) * 4;
          const currentOffset = (y * region.width + x) * 4;
          // Ignore small video conversion/encoding differences, rather than mistaking noise for hidden chrome.
          for (let channel = 0; channel < 3; channel += 1) {
            if (
              Math.abs((current.data[currentOffset + channel] ?? 0) - (before.data[previousOffset + channel] ?? 0)) > 16
            ) {
              changedPixels += 1;
              break;
            }
          }
        }
      }
      return changedPixels >= Math.max(1, region.width * region.height * 0.01);
    });
}
