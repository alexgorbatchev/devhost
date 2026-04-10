import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { readManifest } from "../readManifest";
import { getFixturePath } from "../../utils/__tests__/testUtils";

describe("readManifest", () => {
  test("parses TOML fixtures with Bun's built-in parser", async () => {
    const manifestPath: string = getFixturePath("basic-stack", "devhost.toml");
    const manifestValue: unknown = await readManifest(manifestPath);

    expect(manifestValue).toMatchObject({
      devtools: {
        editor: {
          enabled: true,
          ide: "vscode",
        },
        minimap: {
          enabled: true,
          position: "right",
        },
        status: {
          enabled: true,
          position: "bottom-right",
        },
      },
      name: "hello-stack",
      services: {
        api: {
          command: ["bun", "run", "api:dev"],
          cwd: "./api",
          dependsOn: ["db"],
          health: {
            http: "http://127.0.0.1:4000/healthz",
          },
          host: "api.hello.local.test",
          port: 4000,
        },
        db: {
          command: ["bun", "run", "db:dev"],
          cwd: "./db",
          port: "auto",
        },
        web: {
          command: ["bun", "run", "web:dev"],
          cwd: "./app",
          dependsOn: ["api"],
          env: {
            NODE_ENV: "development",
          },
          host: "hello.local.test",
          port: 3000,
          primary: true,
        },
      },
    });
  });

  test("wraps TOML parse failures", async () => {
    const temporaryDirectoryPath: string = await mkdtemp(join(tmpdir(), "devhost-read-manifest-"));
    const manifestPath: string = join(temporaryDirectoryPath, "devhost.toml");

    await writeFile(manifestPath, "name = [\n", "utf8");

    await expect(readManifest(manifestPath)).rejects.toThrow(`Failed to parse ${manifestPath}:`);
    await rm(temporaryDirectoryPath, { force: true, recursive: true });
  });

  test("explains duplicate TOML tables instead of surfacing a misleading duplicate key", async () => {
    const temporaryDirectoryPath: string = await mkdtemp(join(tmpdir(), "devhost-read-manifest-"));
    const manifestPath: string = join(temporaryDirectoryPath, "devhost.toml");

    await writeFile(
      manifestPath,
      [
        "[services.devhost-www]",
        'command = "bun dev"',
        'cwd = "/tmp/react-starter-kit"',
        'host = "test.localhost"',
        "",
        "[services.devhost-www]",
        "primary = true",
        'command = "bun dev"',
      ].join("\n"),
      "utf8",
    );

    await expect(readManifest(manifestPath)).rejects.toThrow(
      `Failed to parse ${manifestPath}: TOML table [services.devhost-www] is declared more than once (lines 1 and 6). Merge those settings into a single table instead of repeating the header.`,
    );
    await rm(temporaryDirectoryPath, { force: true, recursive: true });
  });
});
