import { planFootageSpeed } from "./planFootageSpeed";
import type { IPromoFootagePlan, IPromoFootageSlot } from "./types";

export function planPromoFootage(slot: IPromoFootageSlot, sourceDuration: number): IPromoFootagePlan {
  const resolveOffset = (offset: number): number => (offset < 0 ? sourceDuration + offset : offset);
  const start = Math.max(0, resolveOffset(slot.from));
  const end = Math.min(sourceDuration, slot.to === undefined ? sourceDuration : resolveOffset(slot.to));
  const sourceSeconds = end - start;
  if (!(sourceSeconds > 0)) {
    throw new Error(
      `Footage ${slot.sourceId} lasts ${sourceDuration}s, which leaves nothing between ${start}s and ${end}s ` +
        `for ${slot.id}`,
    );
  }
  const speed = planFootageSpeed(sourceSeconds, slot.duration);
  return {
    startSeconds: start,
    sourceSeconds,
    speed,
    holdSeconds: Math.max(0, slot.duration - sourceSeconds / speed),
  };
}
