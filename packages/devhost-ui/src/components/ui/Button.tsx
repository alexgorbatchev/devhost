import * as React from "react";
import { type VariantProps } from "class-variance-authority";

import { cn } from "../../lib/utils";
import { buttonVariants } from "./constants";

interface IButtonProps extends React.ComponentProps<"button">, VariantProps<typeof buttonVariants> {}

export function Button({
  className,
  size = "default",
  variant = "default",
  ...props
}: IButtonProps): React.ReactElement {
  return (
    <button
      data-size={size}
      data-slot="button"
      data-variant={variant}
      data-testid="Button"
      className={cn(buttonVariants({ className, size, variant }))}
      {...props}
    />
  );
}
