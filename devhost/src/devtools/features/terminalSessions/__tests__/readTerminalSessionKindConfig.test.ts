import { describe, expect, test } from "bun:test";

import { readTerminalSessionKindConfig } from "../readTerminalSessionKindConfig";

describe("readTerminalSessionKindConfig", () => {
  test("returns the Pi annotation session behavior", () => {
    expect(readTerminalSessionKindConfig("pi-annotation")).toEqual({
      defaultIsExpanded: false,
      isFullscreenExpanded: false,
      shouldAutoRemoveOnExit: false,
      terminalTitle: "Pi terminal",
    });
  });

  test("returns the component-source session behavior", () => {
    expect(readTerminalSessionKindConfig("component-source")).toEqual({
      defaultIsExpanded: true,
      isFullscreenExpanded: true,
      shouldAutoRemoveOnExit: true,
      terminalTitle: "Neovim",
    });
  });
});
