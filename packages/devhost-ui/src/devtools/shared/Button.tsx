import type { JSX, ReactNode } from "react";

import { Button as ShadcnButton } from "@/components/ui/button";

export type ButtonVariant = "danger" | "primary" | "secondary";
type ShadcnButtonVariant = "default" | "destructive" | "outline";

interface IButtonProps {
  ariaControls?: string;
  ariaExpanded?: boolean;
  ariaHaspopup?: boolean | "dialog" | "grid" | "listbox" | "menu" | "tree";
  ariaLabel?: string;
  ariaPressed?: boolean;
  children: ReactNode;
  disabled?: boolean;
  endEnhancer?: ReactNode;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
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
      title={title}
      type={type}
      variant={readShadcnButtonVariant(variant)}
      onClick={onClick}
    >
      {children}
      {endEnhancer !== undefined ? (
        <span
          aria-hidden="true"
          className="inline-grid place-items-center whitespace-nowrap rounded-[var(--radius-sm)] border border-border bg-muted px-1 text-[10px] text-muted-foreground transition-colors group-hover/button:bg-accent group-hover/button:text-accent-foreground group-disabled/button:border-foreground/40 group-disabled/button:bg-inherit group-disabled/button:text-current"
        >
          {endEnhancer}
        </span>
      ) : null}
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

  return "outline";
}
