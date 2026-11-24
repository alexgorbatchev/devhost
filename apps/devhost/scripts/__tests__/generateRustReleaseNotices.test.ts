import { afterEach, beforeEach, expect, it } from "bun:test";
import assert from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateRustReleaseNotices } from "../generateRustReleaseNotices";

let directoryPath: string;
beforeEach(async () => {
  directoryPath = await mkdtemp(join(tmpdir(), "dhn."));
});
afterEach(async () => {
  await rm(directoryPath, { recursive: true, force: true });
});

function metadata() {
  return {
    packages: [
      {
        id: "git+https://example.invalid/source#p@1.2.3",
        name: "p",
        version: "1.2.3",
        license: "MIT",
        license_file: "LICENSE",
        repository: "https://example.invalid/source",
        source: "git+https://example.invalid/source#abcdef",
        manifest_path: join(directoryPath, "Cargo.toml"),
      },
    ],
  };
}
const artifactLog: string = JSON.stringify({
  reason: "compiler-artifact",
  package_id: "git+https://example.invalid/source#p@1.2.3",
});

it("includes the actual Git dependency and its license text without local paths", async () => {
  await Bun.write(join(directoryPath, "LICENSE"), "Fixture permission notice\n");
  const notices = await generateRustReleaseNotices(metadata(), artifactLog);
  expect(notices).toContain("p 1.2.3");
  expect(notices).toContain("git+https://example.invalid/source#abcdef");
  expect(notices).toContain("Fixture permission notice");
  expect(notices).not.toContain(directoryPath);
});

it("refuses a compiled dependency with missing license text", async () => {
  await expect(generateRustReleaseNotices(metadata(), artifactLog)).rejects.toThrow();
});

it("refuses unknown compiled dependencies rather than silently dropping them", async () => {
  await expect(generateRustReleaseNotices({ packages: [] }, artifactLog)).rejects.toThrow(
    "Compiled package is missing",
  );
});

it("refuses empty compiler output", async () => {
  await expect(generateRustReleaseNotices(metadata(), "{}")).rejects.toThrow("no compiled packages");
});

it("does not bundle licenses from unused target packages", async () => {
  const packageMetadata = metadata();
  const firstPackage = packageMetadata.packages[0];
  assert(firstPackage);
  packageMetadata.packages.push({
    ...firstPackage,
    id: "unused",
    name: "unused",
    license_file: "ABSENT",
  });
  await Bun.write(join(directoryPath, "LICENSE"), "Fixture permission notice\n");
  expect(await generateRustReleaseNotices(packageMetadata, artifactLog)).not.toContain("unused");
});
