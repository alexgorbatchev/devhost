import * as React from "react";
import { type VariantProps } from "class-variance-authority";

import { cn } from "../../lib/utils";
import { badgeVariants } from "./constants";

interface IBadgeProps extends React.ComponentProps<"span">, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant = "default", ...props }: IBadgeProps): React.ReactElement {
  return (
    <span
      data-slot="badge"
      data-variant={variant}
      data-testid="Badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}
