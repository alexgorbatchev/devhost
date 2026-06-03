import * as React from "react";
import { type VariantProps } from "class-variance-authority";
import { Slot } from "@radix-ui/react-slot";

import { cn } from "../../lib/utils";
import { buttonVariants } from "./constants";

interface IButtonProps extends React.ComponentProps<"button">, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({
  asChild = false,
  className,
  size = "default",
  variant = "default",
  ...props
}: IButtonProps): React.ReactElement {
  const Component = asChild ? Slot : "button";

  return (
    <Component
      data-size={size}
      data-slot="button"
      data-variant={variant}
      className={cn(buttonVariants({ className, size, variant }))}
      {...props}
    />
  );
}
