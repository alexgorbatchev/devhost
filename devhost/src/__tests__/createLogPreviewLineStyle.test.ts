import { describe, expect, test } from "bun:test";

import { createLogPreviewLineStyle } from "../devtools/createLogPreviewLineStyle";
import { getDevtoolsTheme } from "../devtools/devtoolsTheme";

describe("createLogPreviewLineStyle", () => {
  test("uses the dedicated stderr preview colors so error rows read red at a glance", () => {
    const theme = getDevtoolsTheme("dark");

    expect(createLogPreviewLineStyle(theme, "stderr")).toEqual({
      background: theme.colors.logPreviewStderrBackground,
      boxSizing: "border-box",
      color: theme.colors.logPreviewStderrForeground,
      height: theme.sizes.logPreviewRowHeight,
      lineHeight: theme.sizes.logPreviewRowHeight,
      overflow: "hidden",
      padding: `0 ${theme.spacing.xs}`,
      textOverflow: "ellipsis",
      whiteSpace: "pre",
    });
  });

  test("keeps stdout rows neutral without a hover-outline state", () => {
    const theme = getDevtoolsTheme("light");

    expect(createLogPreviewLineStyle(theme, "stdout")).toEqual({
      background: undefined,
      boxSizing: "border-box",
      color: theme.colors.foreground,
      height: theme.sizes.logPreviewRowHeight,
      lineHeight: theme.sizes.logPreviewRowHeight,
      overflow: "hidden",
      padding: `0 ${theme.spacing.xs}`,
      textOverflow: "ellipsis",
      whiteSpace: "pre",
    });
  });
});
