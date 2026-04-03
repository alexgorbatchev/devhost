import { describe, expect, test } from "bun:test";

import { readPiTerminalPrimaryAction } from "../readPiTerminalPrimaryAction";

describe("readPiTerminalPrimaryAction", () => {
  test("returns the terminate action while the terminal session is still running", () => {
    expect(readPiTerminalPrimaryAction(false)).toEqual({
      label: "Terminate",
      testId: "PiTerminalPanel--terminate",
      title: "Terminate terminal session",
      variant: "danger",
    });
  });

  test("returns the close action after the terminal session exits", () => {
    expect(readPiTerminalPrimaryAction(true)).toEqual({
      label: "Close",
      testId: "PiTerminalPanel--close",
      title: "Close terminal session",
      variant: "secondary",
    });
  });
});
