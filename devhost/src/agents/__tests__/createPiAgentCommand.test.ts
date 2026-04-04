import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

import { createPiAgentCommand } from "../createPiAgentCommand";

describe("createPiAgentCommand", () => {
  test("loads the auto-exit extension for Pi agent sessions", () => {
    const prompt: string = "Fix the highlighted button.";
    const extensionPath: string = fileURLToPath(import.meta.resolve("../registerAutoExitOnAgentEndExtension.ts"));

    expect(createPiAgentCommand(prompt)).toEqual(["pi", "-e", extensionPath, prompt]);
  });
});
