import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { readManifest } from "../readManifest";
import { getFixturePath } from "./testUtils";

describe("readManifest", () => {
  test("parses TOML fixtures with Bun's built-in parser", async () => {
    const manifestPath: string = getFixturePath("basic-stack", "devhost.toml");
    const manifestValue: unknown = await readManifest(manifestPath);

    expect(manifestValue).toMatchObject({
      name: "hello-stack",
      primaryService: "web",
    });
  });

  test("wraps TOML parse failures", async () => {
    const temporaryDirectoryPath: string = await mkdtemp(join(tmpdir(), "devhost-read-manifest-"));
    const manifestPath: string = join(temporaryDirectoryPath, "devhost.toml");

    await writeFile(manifestPath, "name = [\n", "utf8");

    await expect(readManifest(manifestPath)).rejects.toThrow(`Failed to parse ${manifestPath}:`);
    await rm(temporaryDirectoryPath, { force: true, recursive: true });
  });
});
