import type { JSX, MouseEventHandler, ReactNode } from "react";

import { Button as ShadcnButton } from "../../../components/ui/button";

export type ButtonVariant = "danger" | "primary" | "secondary";
export type ButtonSize = "default" | "icon" | "icon-lg" | "icon-sm" | "icon-xs" | "lg" | "sm" | "xs";

type ShadcnButtonVariant = "default" | "destructive" | "secondary";

interface IButtonProps {
  ariaControls?: string;
  ariaExpanded?: boolean;
  ariaHaspopup?: boolean | "dialog" | "grid" | "listbox" | "menu" | "tree";
  ariaLabel?: string;
  ariaPressed?: boolean;
  children?: ReactNode;
  disabled?: boolean;
  endEnhancer?: ReactNode;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  size?: ButtonSize;
  startEnhancer?: ReactNode;
  testId?: string;
  title?: string;
  type?: "button" | "reset" | "submit";
  variant?: ButtonVariant;
}

export function Button({
  ariaControls,
  ariaExpanded,
  ariaHaspopup,
  ariaLabel,
  ariaPressed,
  children,
  disabled = false,
  endEnhancer,
  onClick,
  size = "default",
  startEnhancer,
  testId,
  title,
  type = "button",
  variant = "secondary",
}: IButtonProps): JSX.Element {
  return (
    <ShadcnButton
      aria-controls={ariaControls}
      aria-expanded={ariaExpanded}
      aria-haspopup={ariaHaspopup}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      data-devhost-instance-testid={testId}
      data-testid="Button"
      disabled={disabled}
      size={size}
      title={title}
      type={type}
      variant={readShadcnButtonVariant(variant)}
      onClick={onClick}
    >
      {startEnhancer !== undefined ? <span aria-hidden="true">{startEnhancer}</span> : null}
      {children}
      {endEnhancer !== undefined ? <span aria-hidden="true">{endEnhancer}</span> : null}
    </ShadcnButton>
  );
}

function readShadcnButtonVariant(variant: ButtonVariant): ShadcnButtonVariant {
  if (variant === "primary") {
    return "default";
  }

  if (variant === "danger") {
    return "destructive";
  }

  return "secondary";
}
