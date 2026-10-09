import { join } from "node:path";
import { hashFile } from "./hashFile";
import type { DemoMediaState, IDemoMediaFileState, IDemoMediaManifest } from "./types";

export async function inspectDemoMedia(
  manifest: IDemoMediaManifest,
  directoryPath: string,
): Promise<IDemoMediaFileState[]> {
  // A checkout that has not downloaded the videos has no directory to scan.
  const videos = await Array.fromAsync(new Bun.Glob("*.mp4").scan({ cwd: directoryPath, onlyFiles: true })).catch(
    (): string[] => [],
  );
  const names = [...new Set([...Object.keys(manifest.files), ...videos])].sort();
  const states: IDemoMediaFileState[] = [];
  for (const name of names) {
    const pin = manifest.files[name];
    let state: DemoMediaState = "unpinned";
    if (pin !== undefined) {
      if (!videos.includes(name)) state = "missing";
      else state = (await hashFile(join(directoryPath, name))) === pin.sha256 ? "current" : "different";
    }
    states.push({ name, state });
  }
  return states;
}
