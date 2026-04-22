import { describe, expect, test } from "bun:test";

import { readTerminalSessionPrimaryAction } from "../readTerminalSessionPrimaryAction";

describe("readTerminalSessionPrimaryAction", () => {
  test("returns the terminate action while the terminal session is still running", () => {
    expect(readTerminalSessionPrimaryAction(false)).toEqual({
      label: "Terminate",
      testId: "TerminalSessionPanel--terminate",
      title: "Terminate terminal session",
      variant: "danger",
    });
  });

  test("returns the close action after the terminal session exits", () => {
    expect(readTerminalSessionPrimaryAction(true)).toEqual({
      label: "Close",
      testId: "TerminalSessionPanel--close",
      title: "Close terminal session",
      variant: "secondary",
    });
  });
});
