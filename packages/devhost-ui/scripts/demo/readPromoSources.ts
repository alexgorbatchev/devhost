import { join } from "node:path";
import type { PromoFootageSource } from "./types";

export async function readPromoSources(directoryPath: string): Promise<PromoFootageSource[]> {
  const rawPath = join(directoryPath, "raw");
  const files = await Array.fromAsync(new Bun.Glob("*.{mp4,webm}").scan({ cwd: rawPath, onlyFiles: true })).catch(
    (): string[] => [],
  );
  const sources = files.sort().map((file) => ({ id: file.replace(/\.[^.]+$/, ""), path: join(rawPath, file) }));
  // A frame names a recording without its extension, so two videos with one name would be picked by listing order.
  const ambiguous = sources.find((source, index) => sources.findIndex((other) => other.id === source.id) !== index);
  if (ambiguous) throw new Error(`raw/ holds more than one recording named ${ambiguous.id}`);
  return sources;
}
