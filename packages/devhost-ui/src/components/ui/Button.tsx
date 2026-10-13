import * as React from "react";

import { cn } from "../../lib/utils";
import { buttonVariants } from "./constants";
import { Kbd } from "./Kbd";

export type ButtonVariant = "danger" | "default" | "ghost" | "primary" | "surface" | "warning";
type ButtonJoinedEdge = "end" | "none" | "start";

export interface IButtonProps extends React.ComponentProps<"button"> {
  joinedEdge?: ButtonJoinedEdge;
  variant?: ButtonVariant;
  startEnhancer?: React.ReactNode;
  endEnhancer?: React.ReactNode;
  shortcut?: string;
  testId?: string;
}

export function Button({
  className,
  joinedEdge = "none",
  variant = "default",
  startEnhancer,
  endEnhancer,
  shortcut,
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
      className={cn(buttonVariants({ className, joinedEdge, shape: isIcon ? "icon" : "default", variant }))}
      type={type}
      {...props}
    >
      {startEnhancer !== undefined ? (
        <span aria-hidden="true" className="flex shrink-0 items-center">
          {startEnhancer}
        </span>
      ) : null}
      {children}
      {endEnhancer !== undefined ? (
        <span aria-hidden="true" className="flex shrink-0 items-center">
          {endEnhancer}
        </span>
      ) : null}
      {shortcut !== undefined ? (
        <Kbd
          aria-hidden="true"
          tone={
            props.disabled ||
            variant === "primary" ||
            variant === "warning" ||
            props["aria-pressed"] === true ||
            props["aria-pressed"] === "true"
              ? "on-color"
              : "muted"
          }
        >
          {shortcut}
        </Kbd>
      ) : null}
    </button>
  );
}
