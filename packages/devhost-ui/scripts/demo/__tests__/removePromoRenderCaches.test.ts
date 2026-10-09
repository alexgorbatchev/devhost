import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, expect, it } from "bun:test";
import { removePromoRenderCaches } from "../removePromoRenderCaches";

let temporaryPath = "";

beforeAll(async () => {
  const testsPath = resolve(import.meta.dir, "../../../../../.tmp/demo-tests");
  await mkdir(testsPath, { recursive: true });
  temporaryPath = await mkdtemp(join(testsPath, "render-caches-"));
});

afterAll(async () => {
  await rm(temporaryPath, { recursive: true, force: true });
});

it("removes the renderer's frame cache and package install and keeps the run's other temporary files", async () => {
  await Bun.write(join(temporaryPath, "promo-frames/clip/frame-0001.png"), "frame");
  await Bun.write(join(temporaryPath, "bunx-1000-hyperframes@0.8.143/node_modules/hyperframes/cli.js"), "cli");
  await Bun.write(join(temporaryPath, "pi-sessions/session.jsonl"), "{}");
  await Bun.write(join(temporaryPath, "bunx-notes.txt"), "kept");

  await removePromoRenderCaches(temporaryPath);

  expect((await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: temporaryPath }))).sort()).toEqual([
    "bunx-notes.txt",
    "pi-sessions/session.jsonl",
  ]);
});

it("does nothing when a render left no caches", async () => {
  const emptyPath = join(temporaryPath, "never-rendered");

  await removePromoRenderCaches(emptyPath);

  expect(await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: temporaryPath }))).toHaveLength(2);
});
