import { describe, expect, test } from "bun:test";

import { createCornerDockStyle } from "../devtools/shared/createCornerDockStyle";
import { getDevtoolsTheme } from "../devtools/shared/devtoolsTheme";

describe("createCornerDockStyle", () => {
  test("pins the dock to the configured corner when no minimap is visible", () => {
    const theme = getDevtoolsTheme("light");

    expect(
      createCornerDockStyle(theme, {
        devtoolsMinimapPosition: "right",
        devtoolsPosition: "top-left",
        hasVisibleMinimap: false,
      }),
    ).toMatchObject({
      display: "grid",
      gap: theme.spacing.xxs,
      left: theme.spacing.sm,
      maxWidth: "calc(100vw - 20px)",
      pointerEvents: "auto",
      position: "fixed",
      top: theme.spacing.sm,
      width: "fit-content",
      zIndex: theme.zIndices.floating,
    });
  });

  test("shifts the dock away from a visible minimap on the same side", () => {
    const theme = getDevtoolsTheme("dark");

    expect(
      createCornerDockStyle(theme, {
        devtoolsMinimapPosition: "right",
        devtoolsPosition: "bottom-right",
        hasVisibleMinimap: true,
      }),
    ).toMatchObject({
      bottom: theme.spacing.sm,
      display: "grid",
      gap: theme.spacing.xxs,
      maxWidth: `calc(100vw - 20px - ${theme.sizes.logMinimapPeekWidth} - ${theme.spacing.xxs})`,
      pointerEvents: "auto",
      position: "fixed",
      right: `calc(${theme.spacing.sm} + ${theme.sizes.logMinimapPeekWidth} + ${theme.spacing.xxs})`,
      width: "fit-content",
      zIndex: theme.zIndices.floating,
    });
  });
});
