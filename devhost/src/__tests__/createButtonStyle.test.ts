import { describe, expect, test } from "bun:test";

import { createButtonStyle } from "../devtools/shared/createButtonStyle";
import { getDevtoolsTheme } from "../devtools/shared/devtoolsTheme";

describe("createButtonStyle", () => {
  test("returns the primary button treatment from the shared theme tokens", () => {
    const theme = getDevtoolsTheme("light");

    expect(
      createButtonStyle(theme, {
        isDisabled: false,
        variant: "primary",
      }),
    ).toMatchObject({
      alignItems: "center",
      background: theme.colors.accentBackground,
      border: `1px solid ${theme.colors.accentBackground}`,
      borderRadius: theme.radii.sm,
      color: theme.colors.accentForeground,
      cursor: "pointer",
      display: "inline-flex",
      fontFamily: theme.fontFamilies.monospace,
      fontSize: theme.fontSizes.sm,
      gap: theme.spacing.xs,
      justifyContent: "center",
      opacity: 1,
      padding: `${theme.spacing.xxs} ${theme.spacing.xs}`,
    });
  });

  test("returns a disabled secondary button treatment without changing the shared sizing", () => {
    const theme = getDevtoolsTheme("dark");

    expect(
      createButtonStyle(theme, {
        isDisabled: true,
        variant: "secondary",
      }),
    ).toMatchObject({
      alignItems: "center",
      background: theme.colors.background,
      border: `1px solid ${theme.colors.border}`,
      borderRadius: theme.radii.sm,
      color: theme.colors.foreground,
      cursor: "not-allowed",
      display: "inline-flex",
      fontFamily: theme.fontFamilies.monospace,
      fontSize: theme.fontSizes.sm,
      gap: theme.spacing.xs,
      justifyContent: "center",
      opacity: 0.5,
      padding: `${theme.spacing.xxs} ${theme.spacing.xs}`,
    });
  });
});
