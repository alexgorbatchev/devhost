import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../../lib/utils";

// Errors are a solid strip rather than tinted text so they read on any theme and any host background.
const alertVariants = cva(
  "flex w-full items-center gap-1.5 px-2 py-1 text-left text-md [&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg]:text-current",
  {
    variants: {
      variant: {
        default: "border-y border-border bg-secondary text-foreground",
        destructive: "bg-destructive font-semibold text-destructive-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

type AlertProps = React.ComponentProps<"div"> & VariantProps<typeof alertVariants>;

export function Alert({ className, variant, ...props }: AlertProps) {
  return (
    <div
      data-slot="alert"
      data-testid="Alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

export function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="alert-title" data-testid="AlertTitle" className={cn("font-bold", className)} {...props} />;
}

export function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      data-testid="AlertDescription"
      className={cn("min-w-0 flex-1", className)}
      {...props}
    />
  );
}

export function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      data-testid="AlertAction"
      className={cn("flex shrink-0 items-center gap-1", className)}
      {...props}
    />
  );
}
