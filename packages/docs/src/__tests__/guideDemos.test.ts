import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, it } from "bun:test";

it("plays the first video and loads English captions for every guide, with usable controls and a transcript", async () => {
  const parentPath = resolve(import.meta.dir, "../../../../.tmp/docs-demo-tests");
  await mkdir(parentPath, { recursive: true });
  const directoryPath = await mkdtemp(join(parentPath, "browser-"));
  await mkdir(join(directoryPath, ".tmp"));
  try {
    const subprocess = Bun.spawn([process.execPath, join(import.meta.dir, "helpers.ts")], {
      cwd: directoryPath,
      env: { ...process.env, TMPDIR: ".tmp" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [output, errors, exitCode] = await Promise.all([
      new Response(subprocess.stdout).text(),
      new Response(subprocess.stderr).text(),
      subprocess.exited,
    ]);
    expect({ exitCode, errors }).toEqual({ exitCode: 0, errors: "" });
    expect(JSON.parse(output)).toEqual({ guidesPlayed: 12, captionsLoaded: 12, transcriptsAvailable: 12 });
  } finally {
    await rm(directoryPath, { recursive: true, force: true });
  }
}, 60_000);
