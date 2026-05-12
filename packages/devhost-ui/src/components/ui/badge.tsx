import * as React from "react";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

type BadgeVariant = "default" | "destructive" | "ghost" | "link" | "outline" | "secondary";

interface IBadgeProps extends React.ComponentProps<"span"> {
  asChild?: boolean;
  variant?: BadgeVariant;
}

const baseClassName: string =
  "inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const variantClassNames: Record<BadgeVariant, string> = {
  default: "bg-primary text-primary-foreground",
  destructive: "bg-destructive/10 text-destructive",
  ghost: "hover:bg-muted hover:text-muted-foreground",
  link: "text-primary underline-offset-4 hover:underline",
  outline: "border-border text-foreground",
  secondary: "bg-secondary text-secondary-foreground",
};

export function Badge({ asChild = false, className, variant = "default", ...props }: IBadgeProps): React.ReactElement {
  const Component = asChild ? Slot.Root : "span";

  return (
    <Component
      data-slot="badge"
      data-variant={variant}
      className={cn(baseClassName, variantClassNames[variant], className)}
      {...props}
    />
  );
}
