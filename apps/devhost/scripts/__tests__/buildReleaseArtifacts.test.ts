import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRustReleaseArtifacts } from "../buildReleaseArtifacts";

let directoryPath: string;
beforeEach(async () => {
  directoryPath = await mkdtemp(join(tmpdir(), "dha."));
});
afterEach(async () => {
  await rm(directoryPath, { recursive: true, force: true });
});

it("rejects unsupported targets before creating or replacing output", async () => {
  await expect(
    buildRustReleaseArtifacts({ targets: ["windows-x64"], outputDirectoryPath: directoryPath }),
  ).rejects.toThrow("Unsupported Rust archive target");
  expect(await readdir(directoryPath)).toEqual([]);
});

it("rejects an empty target set", async () => {
  await expect(buildRustReleaseArtifacts({ targets: [] })).rejects.toThrow("at least one release target");
});

it("preserves an existing candidate directory instead of merging or deleting it", async () => {
  const markerPath = join(directoryPath, "prior-candidate");
  await Bun.write(markerPath, "retain");
  await expect(
    buildRustReleaseArtifacts({ targets: ["linux-x64"], outputDirectoryPath: directoryPath }),
  ).rejects.toThrow("Candidate output already exists");
  expect(await Bun.file(markerPath).text()).toBe("retain");
  expect(await readdir(directoryPath)).toEqual(["prior-candidate"]);
});

it("rejects missing documents before compiling or creating output", async () => {
  await expect(
    buildRustReleaseArtifacts({
      targets: ["linux-x64"],
      outputDirectoryPath: join(directoryPath, "output"),
      documentFilePaths: [join(directoryPath, "README.md")],
    }),
  ).rejects.toThrow("Release document not found");
  expect(await readdir(directoryPath)).toEqual([]);
});
