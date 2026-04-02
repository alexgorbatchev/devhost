import type { ComponentChildren, JSX } from "preact";

import { createButtonStyle, type ButtonVariant } from "./createButtonStyle";
import type { IDevtoolsTheme } from "./devtoolsTheme";

interface IButtonProps {
  ariaPressed?: boolean;
  children: ComponentChildren;
  disabled?: boolean;
  onClick?: JSX.MouseEventHandler<HTMLButtonElement>;
  style?: JSX.CSSProperties;
  testId?: string;
  theme: IDevtoolsTheme;
  title?: string;
  type?: "button" | "reset" | "submit";
  variant?: ButtonVariant;
}

export function Button({
  ariaPressed,
  children,
  disabled = false,
  onClick,
  style,
  testId,
  theme,
  title,
  type = "button",
  variant = "secondary",
}: IButtonProps): JSX.Element {
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
      }}
      title={title}
      type={type}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
