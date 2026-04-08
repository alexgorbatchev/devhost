import { describe, expect, test } from "bun:test";

import { getDevtoolsTheme } from "../devtoolsTheme";

describe("getDevtoolsTheme", () => {
  test("keeps tray overlays below floating chrome and expanded terminals above both", () => {
    expect(getDevtoolsTheme("light").zIndices).toEqual({
      floating: 2_147_483_500,
      terminalExpanded: 2_147_483_600,
      terminalTray: 2_147_483_400,
    });
  });

  test("shares the same stacking order across color schemes", () => {
    expect(getDevtoolsTheme("dark").zIndices).toEqual(getDevtoolsTheme("light").zIndices);
  });
});
