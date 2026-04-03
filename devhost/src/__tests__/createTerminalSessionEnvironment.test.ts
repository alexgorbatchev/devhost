import { describe, expect, test } from "bun:test";

import { createTerminalSessionEnvironment } from "../createTerminalSessionEnvironment";

describe("createTerminalSessionEnvironment", () => {
  test("overrides host terminal variables with xterm-compatible values", () => {
    expect(
      createTerminalSessionEnvironment({
        COLORTERM: "256",
        TERM: "xterm-ghostty",
        TERM_PROGRAM: "ghostty",
      }),
    ).toEqual({
      COLORTERM: "truecolor",
      TERM: "xterm-256color",
      TERM_PROGRAM: "devhost",
    });
  });

  test("preserves unrelated environment variables", () => {
    expect(
      createTerminalSessionEnvironment({
        HOME: "/tmp/home",
        PATH: "/usr/bin:/bin",
      }),
    ).toEqual({
      COLORTERM: "truecolor",
      HOME: "/tmp/home",
      PATH: "/usr/bin:/bin",
      TERM: "xterm-256color",
      TERM_PROGRAM: "devhost",
    });
  });
});
