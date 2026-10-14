// A recording never plays slower than it happened: a short one holds its last frame instead.
export function planFootageSpeed(sourceSeconds: number, slotSeconds: number): number {
  return Math.max(1, sourceSeconds / slotSeconds);
}
