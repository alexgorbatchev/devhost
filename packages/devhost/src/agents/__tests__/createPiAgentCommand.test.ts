import { describe, expect, test } from "bun:test";

import { createPiAgentCommand } from "../createPiAgentCommand";

describe("createPiAgentCommand", () => {
  test("passes the rendered prompt file to Pi without the auto-exit extension", () => {
    const promptFilePath: string = "/tmp/prompt.txt";

    expect(createPiAgentCommand(promptFilePath)).toEqual(["pi", `@${promptFilePath}`]);
  });
});
