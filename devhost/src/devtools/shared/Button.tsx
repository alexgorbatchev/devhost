import type { ComponentChildren, JSX } from "preact";
import { useState } from "preact/hooks";

import { createButtonStyle, type ButtonVariant } from "./createButtonStyle";
import type { IDevtoolsTheme } from "./devtoolsTheme";

interface IButtonProps {
  ariaPressed?: boolean;
  children: ComponentChildren;
  disabled?: boolean;
  endEnhancer?: ComponentChildren;
  endEnhancerStyle?: JSX.CSSProperties;
  endEnhancerStyleHover?: JSX.CSSProperties;
  onClick?: JSX.MouseEventHandler<HTMLButtonElement>;
  style?: JSX.CSSProperties;
  styleHover?: JSX.CSSProperties;
  testId?: string;
  theme: IDevtoolsTheme;
  title?: string;
  type?: "button" | "reset" | "submit";
  variant?: ButtonVariant;
}

const endEnhancerBaseStyle: JSX.CSSProperties = {
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
  const [isHovered, setIsHovered] = useState<boolean>(false);

  return (
    <button
      aria-pressed={ariaPressed}
      data-testid={testId}
      disabled={disabled}
      style={{
        ...createButtonStyle(theme, {
          isDisabled: disabled,
          variant,
        }),
        ...style,
        ...(isHovered && !disabled ? styleHover : undefined),
      }}
      title={title}
      type={type}
      onClick={onClick}
      onMouseEnter={(): void => {
        setIsHovered(true);
      }}
      onMouseLeave={(): void => {
        setIsHovered(false);
      }}
    >
      {children}
      {endEnhancer !== undefined ? (
        <span
          style={{
            ...endEnhancerBaseStyle,
            ...endEnhancerStyle,
            ...(isHovered && !disabled ? endEnhancerStyleHover : undefined),
          }}
        >
          {endEnhancer}
        </span>
      ) : null}
    </button>
  );
}
