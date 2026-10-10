import { mkdir, mkdtemp, rm, utimes } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, expect, it } from "bun:test";
import { findPromoRecording } from "../findPromoRecording";

const requested = ["startup", "overview-1", "query-1"];
const footage = ["startup.mp4", "overview-1.webm", "query-1.webm"];

let testsPath = "";
let parentPath = "";

async function createRecording(name: string, files: readonly string[], capturedSeconds: number): Promise<string> {
  const path = join(parentPath, name);
  for (const file of files) {
    await Bun.write(join(path, "raw", file), "footage");
    await utimes(join(path, "raw", file), capturedSeconds, capturedSeconds);
  }
  return path;
}

beforeAll(async () => {
  const demoTestsPath = resolve(import.meta.dir, "../../../../../.tmp/demo-tests");
  await mkdir(demoTestsPath, { recursive: true });
  testsPath = await mkdtemp(join(demoTestsPath, "recordings-"));
});

beforeEach(async () => {
  parentPath = await mkdtemp(join(testsPath, "demos-"));
});

afterAll(async () => {
  await rm(testsPath, { recursive: true, force: true });
});

it("picks the newest recording that holds every recording the composition requests", async () => {
  await createRecording("recording-older-full", footage, 1_000);
  const complete = await createRecording("recording-full", footage, 2_000);
  await createRecording("recording-startup-only", ["startup.mp4"], 3_000);
  await createRecording("recording-screenshots", ["startup.mp4", "overview-1.png", "query-1.png"], 3_500);
  await createRecording("guide-terminal", footage, 4_000);

  expect(await findPromoRecording(parentPath, requested)).toBe(complete);
});

it("ranks a recording by when its footage was captured, not by when a render last wrote to it", async () => {
  const newestCapture = await createRecording("recording-newest-capture", footage, 2_000);
  const renderedAgain = await createRecording("recording-rendered-again", footage, 1_000);
  // A render replaces entries in the recording's directory, which advances the directory's modification time.
  await utimes(newestCapture, 5_000, 5_000);
  await utimes(renderedAgain, 9_000, 9_000);

  expect(await findPromoRecording(parentPath, requested)).toBe(newestCapture);
});

it("names the missing footage when no recording can render the promo", async () => {
  await createRecording("recording-full", footage, 2_000);

  await expect(findPromoRecording(parentPath, ["startup", "annotations-3"])).rejects.toThrow(
    "No recording holds the footage the promo requests (startup, annotations-3); run `just demo record` first",
  );
});
