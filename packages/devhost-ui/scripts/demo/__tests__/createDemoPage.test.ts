import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, it } from "bun:test";
import { runCommand } from "../runCommand";

async function captureAtScale(captureScale: number): Promise<unknown> {
  const parentPath = resolve(import.meta.dir, "../../../../../.tmp/demo-tests");
  await mkdir(parentPath, { recursive: true });
  const directoryPath = await mkdtemp(join(parentPath, "capture-scale-"));
  await Promise.all(["raw", ".tmp"].map((directory) => mkdir(join(directoryPath, directory))));
  try {
    const output = await runCommand(
      [process.execPath, join(import.meta.dir, "fixtures/captureAtScale.ts"), String(captureScale)],
      { cwd: directoryPath, env: { ...process.env, TMPDIR: ".tmp" }, timeoutMs: 25_000 },
    );
    return JSON.parse(output);
  } finally {
    await rm(directoryPath, { recursive: true, force: true });
  }
}

it("records two device pixels per CSS pixel at capture scale 2 without changing the page layout", async () => {
  expect(await captureAtScale(2)).toEqual({
    video: { width: 2560, height: 1440 },
    page: { width: 1280, height: 720, devicePixelRatio: 2 },
  });
}, 30_000);

it("records the page at its CSS size at capture scale 1", async () => {
  expect(await captureAtScale(1)).toEqual({
    video: { width: 1280, height: 720 },
    page: { width: 1280, height: 720, devicePixelRatio: 1 },
  });
}, 30_000);
