import type { CSSObject } from "@emotion/css/create-instance";
import type { ReactNode, JSX } from "react";

import { css } from "./devtoolsCss";
import type { IDevtoolsTheme } from "./devtoolsTheme";
import { useDevtoolsTheme } from "./useDevtoolsTheme";

export type ButtonVariant = "danger" | "primary" | "secondary";

interface IButtonProps {
  ariaPressed?: boolean;
  children: ReactNode;
  disabled?: boolean;
  endEnhancer?: ReactNode;
  endEnhancerStyle?: CSSObject;
  endEnhancerStyleHover?: CSSObject;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  style?: CSSObject;
  styleHover?: CSSObject;
  testId?: string;
  title?: string;
  type?: "button" | "reset" | "submit";
  variant?: ButtonVariant;
}

const buttonEndEnhancerAttributeName: string = "data-devhost-button-end-enhancer";
const buttonHoverSelector: string = "&:is(:hover, :focus-visible)";
const endEnhancerBaseStyle: CSSObject = {
  display: "inline-grid",
  placeItems: "center",
  whiteSpace: "nowrap",
};

export function Button({
  ariaPressed,
  children,
  disabled = false,
  endEnhancer,
  endEnhancerStyle,
  endEnhancerStyleHover,
  onClick,
  style,
  styleHover,
  testId,
  title,
  type = "button",
  variant = "secondary",
}: IButtonProps): JSX.Element {
  const theme = useDevtoolsTheme();
  const buttonClassName: string = css({
    ...readVariantStyle(variant, theme),
    alignItems: "center",
    borderRadius: theme.radii.sm,
    boxShadow: theme.shadows.floating,
    cursor: disabled ? "not-allowed" : "pointer",
    display: "inline-flex",
    fontFamily: theme.fontFamilies.monospace,
    fontSize: theme.fontSizes.sm,
    gap: theme.spacing.xs,
    justifyContent: "center",
    opacity: disabled ? 0.5 : 1,
    padding: `${theme.spacing.xxs} ${theme.spacing.xs}`,
    transition: "opacity 120ms ease",
    ...style,
    ...(disabled || styleHover === undefined
      ? undefined
      : {
          [buttonHoverSelector]: styleHover,
        }),
    ...(disabled || endEnhancerStyleHover === undefined
      ? undefined
      : {
          [`${buttonHoverSelector} [${buttonEndEnhancerAttributeName}]`]: endEnhancerStyleHover,
        }),
  });
  const endEnhancerClassName: string = css({
    ...endEnhancerBaseStyle,
    ...endEnhancerStyle,
  });

  return (
    <button
      aria-pressed={ariaPressed}
      className={buttonClassName}
      data-devhost-instance-testid={testId}
      data-testid="Button"
      disabled={disabled}
      title={title}
      type={type}
      onClick={onClick}
    >
      {children}
      {endEnhancer !== undefined ? (
        <span className={endEnhancerClassName} data-devhost-button-end-enhancer="">
          {endEnhancer}
        </span>
      ) : null}
    </button>
  );
}

function readVariantStyle(variant: ButtonVariant, theme: IDevtoolsTheme): CSSObject {
  if (variant === "secondary") {
    return {
      background: theme.colors.background,
      border: `1px solid ${theme.colors.border}`,
      color: theme.colors.foreground,
    };
  }

  if (variant === "danger") {
    return {
      background: theme.colors.dangerBackground,
      border: `1px solid ${theme.colors.dangerBackground}`,
      color: theme.colors.accentForeground,
    };
  }

  return {
    background: theme.colors.accentBackground,
    border: `1px solid ${theme.colors.accentBackground}`,
    color: theme.colors.accentForeground,
  };
}
