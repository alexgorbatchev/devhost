import type { JSX } from "preact";

import type { IDevtoolsTheme } from "./devtoolsTheme";

export type ButtonVariant = "danger" | "primary" | "secondary";

interface ICreateButtonStyleOptions {
  isDisabled: boolean;
  variant: ButtonVariant;
}

export function createButtonStyle(
  theme: IDevtoolsTheme,
  options: ICreateButtonStyleOptions,
): JSX.CSSProperties {
  const variantStyle: JSX.CSSProperties = createVariantStyle(theme, options.variant);

  return {
    ...variantStyle,
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

function createVariantStyle(theme: IDevtoolsTheme, variant: ButtonVariant): JSX.CSSProperties {
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
