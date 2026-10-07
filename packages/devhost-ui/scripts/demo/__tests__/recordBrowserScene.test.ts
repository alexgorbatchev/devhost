import { expect, it } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runCommand } from "../runCommand";

it("records an already loaded page across scenes and rejects a captured reload", async () => {
  const parentPath = resolve(import.meta.dir, "../../../../../.tmp/demo-tests");
  await mkdir(parentPath, { recursive: true });
  const directoryPath = await mkdtemp(join(parentPath, "browser-"));
  await Promise.all(["raw", ".tmp"].map((directory) => mkdir(join(directoryPath, directory))));
  try {
    const output = await runCommand([process.execPath, join(import.meta.dir, "helpers.ts")], {
      cwd: directoryPath,
      env: { ...process.env, TMPDIR: ".tmp" },
      timeoutMs: 15_000,
    });
    expect(JSON.parse(output)).toEqual({
      loadsBeforeReload: 1,
      retainedValue: "Preserved between scenes",
      clips: 2,
      rejectedReload: true,
    });
  } finally {
    await rm(directoryPath, { recursive: true, force: true });
  }
}, 20_000);
