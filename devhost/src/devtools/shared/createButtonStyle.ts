import type { CSSObject } from "@emotion/css/create-instance";

import type { IDevtoolsTheme } from "./devtoolsTheme";

export type ButtonVariant = "danger" | "primary" | "secondary";

interface ICreateButtonStyleOptions {
  isDisabled: boolean;
  variant: ButtonVariant;
}

export function createButtonStyle(
  theme: IDevtoolsTheme,
  options: ICreateButtonStyleOptions,
): CSSObject {
  const variantStyle: CSSObject = createVariantStyle(theme, options.variant);

  return {
    ...variantStyle,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.xs,
    padding: `${theme.spacing.xxs} ${theme.spacing.xs}`,
    borderRadius: theme.radii.sm,
    fontFamily: theme.fontFamilies.monospace,
    fontSize: theme.fontSizes.sm,
    boxShadow: theme.shadows.floating,
    cursor: options.isDisabled ? "not-allowed" : "pointer",
    opacity: options.isDisabled ? 0.5 : 1,
    transition: "opacity 120ms ease",
  };
}

function createVariantStyle(theme: IDevtoolsTheme, variant: ButtonVariant): CSSObject {
  if (variant === "secondary") {
    return {
      border: `1px solid ${theme.colors.border}`,
      background: theme.colors.background,
      color: theme.colors.foreground,
    };
  }

  if (variant === "danger") {
    return {
      border: `1px solid ${theme.colors.dangerBackground}`,
      background: theme.colors.dangerBackground,
      color: theme.colors.accentForeground,
    };
  }

  return {
    border: `1px solid ${theme.colors.accentBackground}`,
    background: theme.colors.accentBackground,
    color: theme.colors.accentForeground,
  };
}
