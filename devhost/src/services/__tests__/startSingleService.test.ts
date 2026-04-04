import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import type { ISingleServiceCommandLineArguments } from "../../manifest/parseCommandLineArguments";
import { createSingleServiceEnvironment, createSingleServiceManifest } from "../startSingleService";

const originalDevtoolsComponentEditor: string | undefined = process.env.DEVHOST_COMPONENT_EDITOR;

type EnvironmentEntry = [string, string];
type MaybeEnvironmentEntry = [string, string | undefined];

function isEnvironmentEntry(entry: MaybeEnvironmentEntry): entry is EnvironmentEntry {
  return typeof entry[1] === "string";
}

function restoreDevtoolsComponentEditorEnvironment(): void {
  delete process.env.DEVHOST_COMPONENT_EDITOR;

  const restoredEnvironmentEntries: EnvironmentEntry[] = Object.entries({
    DEVHOST_COMPONENT_EDITOR: originalDevtoolsComponentEditor,
  }).filter(isEnvironmentEntry);

  restoredEnvironmentEntries.forEach(([environmentName, environmentValue]: EnvironmentEntry): void => {
    process.env[environmentName] = environmentValue;
  });
}

afterEach(() => {
  restoreDevtoolsComponentEditorEnvironment();
});

describe("createSingleServiceEnvironment", () => {
  test("injects bind host, routed host, and port without HOST", () => {
    const arguments_: ISingleServiceCommandLineArguments = {
      command: ["bun", "run", "dev"],
      host: "hello.xcv.lol",
      kind: "single-service",
      port: 3200,
    };

    expect(createSingleServiceEnvironment(arguments_)).toEqual({
      DEVHOST_BIND_HOST: "127.0.0.1",
      DEVHOST_HOST: "hello.xcv.lol",
      PORT: "3200",
    });
  });

  test("creates a synthetic single-service manifest for the shared stack runtime", () => {
    const arguments_: ISingleServiceCommandLineArguments = {
      command: ["bun", "run", "dev"],
      host: "hello.xcv.lol",
      kind: "single-service",
      port: 3200,
    };

    expect(createSingleServiceManifest(arguments_)).toEqual({
      agent: {
        displayName: "Pi",
        kind: "pi",
      },
      devtools: true,
      devtoolsComponentEditor: "vscode",
      devtoolsMinimapPosition: "right",
      devtoolsPosition: "bottom-right",
      manifestDirectoryPath: process.cwd(),
      manifestPath: join(process.cwd(), "devhost.synthetic.toml"),
      name: "devhost",
      primaryService: "hello.xcv.lol",
      services: {
        "hello.xcv.lol": {
          bindHost: "127.0.0.1",
          command: ["bun", "run", "dev"],
          cwd: process.cwd(),
          dependsOn: [],
          env: {},
          health: {
            host: "127.0.0.1",
            kind: "tcp",
            port: 3200,
          },
          host: "hello.xcv.lol",
          name: "hello.xcv.lol",
          port: 3200,
          portSource: "fixed",
        },
      },
    });
  });

  test("reads the single-service component editor from the environment", () => {
    process.env.DEVHOST_COMPONENT_EDITOR = "neovim";

    const arguments_: ISingleServiceCommandLineArguments = {
      command: ["bun", "run", "dev"],
      host: "hello.xcv.lol",
      kind: "single-service",
      port: 3200,
    };

    expect(createSingleServiceManifest(arguments_).devtoolsComponentEditor).toBe("neovim");
  });
});
