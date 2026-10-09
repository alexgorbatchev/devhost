import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, expect, it } from "bun:test";
import { removePromoRenderCaches } from "../removePromoRenderCaches";

let testsPath = "";
let temporaryPath = "";

function listFiles(): Promise<string[]> {
  return Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: temporaryPath }));
}

beforeAll(async () => {
  const parentPath = resolve(import.meta.dir, "../../../../../.tmp/demo-tests");
  await mkdir(parentPath, { recursive: true });
  testsPath = await mkdtemp(join(parentPath, "render-caches-"));
});

beforeEach(async () => {
  temporaryPath = await mkdtemp(join(testsPath, "run-"));
});

afterAll(async () => {
  await rm(testsPath, { recursive: true, force: true });
});

it("removes the renderer's frame cache and package install and keeps the run's other temporary files", async () => {
  await Bun.write(join(temporaryPath, "promo-frames/clip/frame-0001.png"), "frame");
  await Bun.write(join(temporaryPath, "bunx-1000-hyperframes@0.8.143/node_modules/hyperframes/cli.js"), "cli");
  await Bun.write(join(temporaryPath, "pi-sessions/session.jsonl"), "{}");
  await Bun.write(join(temporaryPath, "bunx-notes.txt"), "kept");

  await removePromoRenderCaches(temporaryPath);

  expect((await listFiles()).sort()).toEqual(["bunx-notes.txt", "pi-sessions/session.jsonl"]);
});

it("leaves a run that rendered nothing as it was", async () => {
  await Bun.write(join(temporaryPath, "pi-sessions/session.jsonl"), "{}");

  await removePromoRenderCaches(temporaryPath);

  expect(await listFiles()).toEqual(["pi-sessions/session.jsonl"]);
});

it("does nothing for a run directory that was never created", async () => {
  await removePromoRenderCaches(join(temporaryPath, "never-rendered"));

  expect(await listFiles()).toEqual([]);
});
