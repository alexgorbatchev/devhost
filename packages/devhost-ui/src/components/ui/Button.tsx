import * as React from "react";

import { cn } from "../../lib/utils";
import { buttonVariants } from "./constants";

export type ButtonVariant = "danger" | "default" | "ghost" | "primary" | "warning";

export interface IButtonProps extends React.ComponentProps<"button"> {
  variant?: ButtonVariant;
  startEnhancer?: React.ReactNode;
  endEnhancer?: React.ReactNode;
  testId?: string;
}

export function Button({
  className,
  variant = "default",
  startEnhancer,
  endEnhancer,
  testId,
  children,
  type = "button",
  ...props
}: IButtonProps): React.ReactElement {
  const isIcon: boolean =
    (startEnhancer !== undefined || endEnhancer !== undefined) && React.Children.count(children) === 0;

  return (
    <button
      data-slot="button"
      data-variant={variant}
      data-testid="Button"
      data-devhost-instance-testid={testId}
      className={cn(buttonVariants({ className, shape: isIcon ? "icon" : "default", variant }))}
      type={type}
      {...props}
    >
      {startEnhancer !== undefined ? <span aria-hidden="true">{startEnhancer}</span> : null}
      {children}
      {endEnhancer !== undefined ? <span aria-hidden="true">{endEnhancer}</span> : null}
    </button>
  );
}
