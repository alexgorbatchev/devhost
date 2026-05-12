import * as React from "react";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

type ButtonVariant = "default" | "destructive" | "ghost" | "link" | "outline" | "secondary";
type ButtonSize = "default" | "icon" | "icon-lg" | "icon-sm" | "icon-xs" | "lg" | "sm" | "xs";

interface IButtonProps extends React.ComponentProps<"button"> {
  asChild?: boolean;
  size?: ButtonSize;
  variant?: ButtonVariant;
}

const baseClassName: string =
  "group/button inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";

const variantClassNames: Record<ButtonVariant, string> = {
  default: "bg-primary text-primary-foreground hover:bg-primary/80",
  destructive: "bg-destructive/10 text-destructive hover:bg-destructive/20",
  ghost: "hover:bg-muted hover:text-foreground",
  link: "text-primary underline-offset-4 hover:underline",
  outline: "border-border bg-background hover:bg-muted hover:text-foreground",
  secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
};

const sizeClassNames: Record<ButtonSize, string> = {
  default: "h-8 px-2.5",
  icon: "size-8",
  "icon-lg": "size-9",
  "icon-sm": "size-7",
  "icon-xs": "size-6",
  lg: "h-9 px-2.5",
  sm: "h-7 px-2.5 text-[0.8rem]",
  xs: "h-6 px-2 text-xs",
};

export function Button({
  asChild = false,
  className,
  size = "default",
  variant = "default",
  ...props
}: IButtonProps): React.ReactElement {
  const Component = asChild ? Slot.Root : "button";

  return (
    <Component
      data-size={size}
      data-slot="button"
      data-variant={variant}
      className={cn(baseClassName, variantClassNames[variant], sizeClassNames[size], className)}
      {...props}
    />
  );
}
