import type { CSSObject } from "@emotion/css/create-instance";
import type { ComponentChildren, JSX } from "preact";

import { css } from "./devtoolsCss";
import { createButtonStyle, type ButtonVariant } from "./createButtonStyle";
import type { IDevtoolsTheme } from "./devtoolsTheme";

interface IButtonProps {
  ariaPressed?: boolean;
  children: ComponentChildren;
  disabled?: boolean;
  endEnhancer?: ComponentChildren;
  endEnhancerStyle?: CSSObject;
  endEnhancerStyleHover?: CSSObject;
  onClick?: JSX.MouseEventHandler<HTMLButtonElement>;
  style?: CSSObject;
  styleHover?: CSSObject;
  testId?: string;
  theme: IDevtoolsTheme;
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
  theme,
  title,
  type = "button",
  variant = "secondary",
}: IButtonProps): JSX.Element {
  const buttonClassName: string = css({
    ...createButtonStyle(theme, {
      isDisabled: disabled,
      variant,
    }),
    ...style,
    ...(disabled || styleHover === undefined
      ? undefined
      : {
          [buttonHoverSelector]: styleHover,
        }),
    ...(endEnhancerStyleHover === undefined || disabled
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
      class={buttonClassName}
      data-testid={testId}
      disabled={disabled}
      title={title}
      type={type}
      onClick={onClick}
    >
      {children}
      {endEnhancer !== undefined ? (
        <span class={endEnhancerClassName} data-devhost-button-end-enhancer="">
          {endEnhancer}
        </span>
      ) : null}
    </button>
  );
}
