import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { resolveManifestPath } from "../resolveManifestPath";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directoryPath) => {
      await rm(directoryPath, { force: true, recursive: true });
    }),
  );
});

describe("resolveManifestPath", () => {
  test("finds a manifest from a nested working directory", async () => {
    const rootDirectoryPath: string = await mkdtemp(join(tmpdir(), "devhost-manifest-"));
    const nestedDirectoryPath: string = join(rootDirectoryPath, "packages", "web", "src");

    temporaryDirectories.push(rootDirectoryPath);
    await mkdir(join(rootDirectoryPath, ".git"));
    await mkdir(nestedDirectoryPath, { recursive: true });
    await writeFile(join(rootDirectoryPath, "devhost.toml"), 'name = "stack"\nprimaryService = "web"\n[services.web]\ncommand = ["bun"]\nport = 3000\n');

    await expect(resolveManifestPath(nestedDirectoryPath)).resolves.toBe(join(rootDirectoryPath, "devhost.toml"));
  });

  test("stops at the repository root", async () => {
    const rootDirectoryPath: string = await mkdtemp(join(tmpdir(), "devhost-manifest-"));
    const nestedDirectoryPath: string = join(rootDirectoryPath, "packages", "web");

    temporaryDirectories.push(rootDirectoryPath);
    await mkdir(join(rootDirectoryPath, ".git"));
    await mkdir(nestedDirectoryPath, { recursive: true });

    await expect(resolveManifestPath(nestedDirectoryPath)).rejects.toThrow(
      `Could not find devhost.toml from ${nestedDirectoryPath} upward.`,
    );
  });
});
