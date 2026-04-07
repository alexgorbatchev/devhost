import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

import { createPiAgentCommand } from "../createPiAgentCommand";

describe("createPiAgentCommand", () => {
  test("loads the auto-exit extension for Pi agent sessions", () => {
    const promptFilePath: string = "/tmp/prompt.txt";
    const extensionPath: string = fileURLToPath(import.meta.resolve("../registerAutoExitOnAgentEndExtension.ts"));

    expect(createPiAgentCommand(promptFilePath)).toEqual(["pi", "-e", extensionPath, `@${promptFilePath}`]);
  });
});
