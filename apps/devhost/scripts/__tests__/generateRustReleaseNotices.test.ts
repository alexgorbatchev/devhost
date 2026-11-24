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

it("includes pinned Apple framework license declarations and the full offered Apache license", async () => {
  for (const name of ["objc2-core-foundation", "objc2-core-services", "objc2-io-kit"]) {
    const packageMetadata = metadata();
    const item = packageMetadata.packages[0];
    assert(item);
    Object.assign(item, {
      name,
      version: "0.3.2",
      repository: "https://github.com/madsmtm/objc2",
      license: "Zlib OR Apache-2.0 OR MIT",
      license_file: null,
    });
    const notices = await generateRustReleaseNotices(packageMetadata, artifactLog);
    expect(notices).toContain(`${name} 0.3.2`);
    expect(notices).toContain("Apple SDKs");
    expect(notices).toContain("TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION");
    item.version = "0.3.3";
    await expect(generateRustReleaseNotices(packageMetadata, artifactLog)).rejects.toThrow("No bundled license text");
  }
});
