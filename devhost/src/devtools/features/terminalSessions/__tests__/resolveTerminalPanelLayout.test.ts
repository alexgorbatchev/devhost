import { describe, expect, test } from "bun:test";

import { resolveTerminalPanelLayout } from "../resolveTerminalPanelLayout";

describe("resolveTerminalPanelLayout", () => {
  test("keeps Pi annotation sessions at the bounded modal size", () => {
    expect(resolveTerminalPanelLayout("pi-annotation", 1600, 1000)).toEqual({
      expandedPanelSize: {
        height: 720,
        width: 1040,
      },
      isFullscreenExpanded: false,
      trayPanelSize: {
        height: 720,
        width: 1040,
      },
    });
  });

  test("expands component-source sessions to the full viewport", () => {
    expect(resolveTerminalPanelLayout("component-source", 1600, 1000)).toEqual({
      expandedPanelSize: {
        height: 1000,
        width: 1600,
      },
      isFullscreenExpanded: true,
      trayPanelSize: {
        height: 720,
        width: 1040,
      },
    });
  });

  test("keeps small viewports above the minimum tray size", () => {
    expect(resolveTerminalPanelLayout("component-source", 200, 180)).toEqual({
      expandedPanelSize: {
        height: 180,
        width: 200,
      },
      isFullscreenExpanded: true,
      trayPanelSize: {
        height: 240,
        width: 320,
      },
    });
  });
});
