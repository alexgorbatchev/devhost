import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, expect, it } from "bun:test";
import { readPromoSources } from "../readPromoSources";

let parentPath = "";

async function createRecording(name: string, files: readonly string[]): Promise<string> {
  const path = join(parentPath, name);
  for (const file of files) await Bun.write(join(path, "raw", file), "footage");
  return path;
}

beforeAll(async () => {
  const testsPath = resolve(import.meta.dir, "../../../../../.tmp/demo-tests");
  await mkdir(testsPath, { recursive: true });
  parentPath = await mkdtemp(join(testsPath, "sources-"));
});

afterAll(async () => {
  await rm(parentPath, { recursive: true, force: true });
});

it("names each captured video by its file name and ignores everything else in raw/", async () => {
  const path = await createRecording("videos", ["startup.mp4", "overview-1.webm", "notes.txt", "startup.png"]);

  expect(await readPromoSources(path)).toEqual([
    { id: "overview-1", path: join(path, "raw/overview-1.webm") },
    { id: "startup", path: join(path, "raw/startup.mp4") },
  ]);
});

it("rejects two videos that a frame could not tell apart", async () => {
  const path = await createRecording("ambiguous", ["startup.mp4", "startup.webm"]);

  await expect(readPromoSources(path)).rejects.toThrow("raw/ holds more than one recording named startup");
});

it("finds no videos in a directory that has no raw recordings", async () => {
  expect(await readPromoSources(join(parentPath, "missing"))).toEqual([]);
});
