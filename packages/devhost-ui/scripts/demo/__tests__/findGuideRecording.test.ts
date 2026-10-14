import { mkdir, mkdtemp, rm, utimes } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, expect, it } from "bun:test";
import { findGuideRecording } from "../findGuideRecording";
import type { IGuideRecord } from "../types";

let testsPath = "";
let parentPath = "";

function createRecord(slug: string): IGuideRecord {
  return {
    slug,
    title: "Stack lifecycle",
    address: "terminal",
    clips: [{ clip: "step-1", footage: { sourceId: "guide", from: 0, to: 4 } }],
  };
}

// A run's footage keeps the time it was captured; its record is rewritten each time its film is rendered.
async function createRun(
  name: string,
  record: unknown,
  capturedSeconds: number,
  renderedSeconds: number = capturedSeconds,
): Promise<string> {
  const path = join(parentPath, name);
  await Bun.write(join(path, "raw/guide.mp4"), "footage");
  await Bun.write(join(path, "guide.json"), JSON.stringify(record));
  await utimes(join(path, "raw/guide.mp4"), capturedSeconds, capturedSeconds);
  await utimes(join(path, "guide.json"), renderedSeconds, renderedSeconds);
  return path;
}

beforeAll(async () => {
  const demoTestsPath = resolve(import.meta.dir, "../../../../../.tmp/demo-tests");
  await mkdir(demoTestsPath, { recursive: true });
  testsPath = await mkdtemp(join(demoTestsPath, "guide-recordings-"));
});

beforeEach(async () => {
  parentPath = await mkdtemp(join(testsPath, "demos-"));
});

afterAll(async () => {
  await rm(testsPath, { recursive: true, force: true });
});

// The two runs are created and named the same way in both cases, so the newest capture is not always the run that
// is listed last. The older capture was rendered again later, which must not make it the newest.
it.each([
  [
    { name: "recording-a", captured: 2_000, rendered: 3_000 },
    { name: "recording-b", captured: 1_000, rendered: 9_000 },
    "recording-a",
  ],
  [
    { name: "recording-a", captured: 1_000, rendered: 9_000 },
    { name: "recording-b", captured: 2_000, rendered: 3_000 },
    "recording-b",
  ],
])(
  "finds the most recently captured recording of a guide and what was recorded in it",
  async (first, second, newest) => {
    await createRun(first.name, createRecord("stack-lifecycle"), first.captured, first.rendered);
    await createRun(second.name, createRecord("stack-lifecycle"), second.captured, second.rendered);
    await createRun("recording-other-guide", createRecord("managed-caddy"), 5_000);

    expect(await findGuideRecording(parentPath, "stack-lifecycle")).toEqual({
      directoryPath: join(parentPath, newest),
      record: createRecord("stack-lifecycle"),
    });
  },
);

it("keeps the poster frame a clip marked, so a film rendered again keeps its poster", async () => {
  const record: IGuideRecord = {
    ...createRecord("annotations"),
    clips: [{ clip: "annotations-1", footage: { sourceId: "annotations-1" }, poster: 10.6 }],
  };
  await createRun("recording-marked", record, 1_000);

  expect((await findGuideRecording(parentPath, "annotations")).record).toEqual(record);
});

it("skips a run whose record is not a guide's", async () => {
  const usable = await createRun("recording-usable", createRecord("stack-lifecycle"), 1_000);
  await createRun("recording-broken", { slug: "stack-lifecycle", clips: "none" }, 2_000);

  expect((await findGuideRecording(parentPath, "stack-lifecycle")).directoryPath).toBe(usable);
});

it("says how to record a guide that has no recording", async () => {
  await createRun("recording-other-guide", createRecord("managed-caddy"), 1_000);

  await expect(findGuideRecording(parentPath, "stack-lifecycle")).rejects.toThrow(
    "No recording of the stack-lifecycle guide; run `just demo guides stack-lifecycle` first",
  );
});
