import * as React from "react";

import { cn } from "../../lib/utils";
import { buttonVariants } from "./constants";

export type ButtonSize = "default" | "lg" | "sm" | "xs";
export type ButtonVariant = "default" | "danger" | "primary" | "secondary";

export interface IButtonProps extends Omit<React.ComponentProps<"button">, "size"> {
  size?: ButtonSize;
  variant?: ButtonVariant;
  startEnhancer?: React.ReactNode;
  endEnhancer?: React.ReactNode;
  testId?: string;
}

export function Button({
  className,
  size = "default",
  variant = "default",
  startEnhancer,
  endEnhancer,
  testId,
  children,
  ...props
}: IButtonProps): React.ReactElement {
  const isIcon = (startEnhancer !== undefined || endEnhancer !== undefined) && React.Children.count(children) === 0;
  const mappedSize = readShadcnButtonSize(isIcon, size);
  const mappedVariant = readShadcnButtonVariant(variant);

  return (
    <button
      data-size={size}
      data-slot="button"
      data-variant={variant}
      data-testid="Button"
      data-devhost-instance-testid={testId}
      className={cn(buttonVariants({ className, size: mappedSize, variant: mappedVariant }))}
      {...props}
    >
      {startEnhancer !== undefined ? <span aria-hidden="true">{startEnhancer}</span> : null}
      {children}
      {endEnhancer !== undefined ? <span aria-hidden="true">{endEnhancer}</span> : null}
    </button>
  );
}

function readShadcnButtonSize(icon: boolean, size: ButtonSize) {
  if (icon) {
    if (size === "lg") return "icon-lg";
    if (size === "sm") return "icon-sm";
    if (size === "xs") return "icon-xs";
    return "icon";
  }
  return size;
}

function readShadcnButtonVariant(variant: ButtonVariant) {
  if (variant === "primary") return "default";
  if (variant === "danger") return "destructive";
  return "secondary";
}
