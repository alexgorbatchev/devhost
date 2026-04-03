import { describe, expect, test } from "bun:test";

import { readPiTerminalPrimaryAction } from "../readPiTerminalPrimaryAction";

describe("readPiTerminalPrimaryAction", () => {
  test("returns the terminate action while the Pi session is still running", () => {
    expect(readPiTerminalPrimaryAction(false)).toEqual({
      label: "Terminate",
      testId: "PiTerminalPanel--terminate",
      title: "Terminate Pi terminal",
      variant: "danger",
    });
  });

  test("returns the close action after the Pi session exits", () => {
    expect(readPiTerminalPrimaryAction(true)).toEqual({
      label: "Close",
      testId: "PiTerminalPanel--close",
      title: "Close Pi terminal",
      variant: "secondary",
    });
  });
});
