import { mkdir, mkdtemp, rm, utimes } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, expect, it } from "bun:test";
import { findPromoRecording } from "../findPromoRecording";

let parentPath = "";

async function createRecording(name: string, files: readonly string[], modifiedSeconds: number): Promise<string> {
  const path = join(parentPath, name);
  for (const file of files) await Bun.write(join(path, "raw", file), "footage");
  await utimes(path, modifiedSeconds, modifiedSeconds);
  return path;
}

beforeAll(async () => {
  const testsPath = resolve(import.meta.dir, "../../../../../.tmp/demo-tests");
  await mkdir(testsPath, { recursive: true });
  parentPath = await mkdtemp(join(testsPath, "recordings-"));
});

afterAll(async () => {
  await rm(parentPath, { recursive: true, force: true });
});

it("picks the newest recording that holds every recording the composition requests", async () => {
  await createRecording("recording-older-full", ["startup.mp4", "overview-1.webm", "query-1.webm"], 1_000);
  const complete = await createRecording("recording-full", ["startup.mp4", "overview-1.webm", "query-1.webm"], 2_000);
  await createRecording("recording-startup-only", ["startup.mp4"], 3_000);
  await createRecording("recording-screenshots", ["startup.mp4", "overview-1.png", "query-1.png"], 3_500);
  await createRecording("guide-terminal", ["startup.mp4", "overview-1.webm", "query-1.webm"], 4_000);

  expect(await findPromoRecording(parentPath, ["startup", "overview-1", "query-1"])).toBe(complete);
});

it("names the missing footage when no recording can render the promo", async () => {
  await expect(findPromoRecording(parentPath, ["startup", "annotations-3"])).rejects.toThrow(
    "No recording holds the footage the promo requests (startup, annotations-3); run `just demo record` first",
  );
});
