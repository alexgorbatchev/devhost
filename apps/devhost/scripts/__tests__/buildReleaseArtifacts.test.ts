import { Archive } from "bun";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import assert from "node:assert";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { buildReleaseArtifacts } from "../buildReleaseArtifacts";

const repositoryPath: string = resolve(import.meta.dir, "../../../..");

it("prints the workspace command when requesting release build help", async () => {
  const command = Bun.spawn(["just", "devhost", "build-release-artifacts", "--help"], {
    cwd: repositoryPath,
    stdout: "pipe",
    stderr: "pipe",
  });

  expect(await new Response(command.stdout).text()).toBe(
    "Usage: just devhost build-release-artifacts [--targets=<comma-separated targets>]\n" +
      "Default targets: darwin-arm64, linux-x64, linux-arm64, linux-x64-musl, linux-arm64-musl\n",
  );
  await new Response(command.stderr).text();
  expect(await command.exited).toBe(0);
});

describe("buildReleaseArtifacts", () => {
  let directoryPath: string;
  let outputDirectoryPath: string;

  beforeEach(async () => {
    const temporaryRootPath = join(repositoryPath, ".tmp");
    await mkdir(temporaryRootPath, { recursive: true });
    directoryPath = await mkdtemp(join(temporaryRootPath, "release-artifacts-"));
    outputDirectoryPath = join(directoryPath, "release");
  });

  afterEach(async () => {
    await rm(directoryPath, { recursive: true, force: true });
  });

  it("packages the binary with the README and the repository license", async () => {
    await buildReleaseArtifacts({ outputDirectoryPath, targets: ["linux-x64"] });

    const archiveNames = await readdir(outputDirectoryPath);
    expect(archiveNames.length).toBe(1);
    const archiveName = archiveNames[0];
    assert(archiveName);
    const files = await new Archive(await Bun.file(join(outputDirectoryPath, archiveName)).bytes()).files();
    const archiveDirectoryName = archiveName.slice(0, -".tar.gz".length);

    expect([...files.keys()].sort()).toEqual(
      ["LICENSE", "README.md", "devhost"].map((fileName) => `${archiveDirectoryName}/${fileName}`),
    );
    const license = files.get(`${archiveDirectoryName}/LICENSE`);
    assert(license);
    expect(await license.text()).toBe(await Bun.file(join(repositoryPath, "LICENSE")).text());
    // This test cross-compiles devhost. With an empty Go build cache the build alone outlasts the default five seconds.
  }, 120_000);

  it("fails before building anything when a release document is missing", async () => {
    const missingDocumentPath = join(directoryPath, "LICENSE");

    await expect(
      buildReleaseArtifacts({
        documentFilePaths: [missingDocumentPath],
        outputDirectoryPath,
        targets: ["linux-x64"],
      }),
    ).rejects.toThrow(`Release document not found: ${missingDocumentPath}`);
    expect(await readdir(directoryPath)).toEqual([]);
  });
});
