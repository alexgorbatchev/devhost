import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

import { createPiTerminalSessionCommand } from "../createPiTerminalSessionCommand";

describe("createPiTerminalSessionCommand", () => {
  test("loads the auto-exit extension for annotation Pi sessions", () => {
    const prompt: string = "Fix the highlighted button.";
    const extensionPath: string = fileURLToPath(import.meta.resolve("../registerAutoExitOnAgentEndExtension.ts"));

    expect(createPiTerminalSessionCommand(prompt)).toEqual(["pi", "-e", extensionPath, prompt]);
  });
});
