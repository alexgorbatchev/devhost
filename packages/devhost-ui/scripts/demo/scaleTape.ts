export function scaleTape(tape: string, scale: number): string {
  if (!Number.isInteger(scale) || scale < 1) throw new Error("Tape scale must be a positive integer");
  return tape.replace(
    /^Set (Width|Height|FontSize|Padding) (\d+)$/gm,
    (_line, setting: string, pixels: string): string => `Set ${setting} ${Number(pixels) * scale}`,
  );
}
