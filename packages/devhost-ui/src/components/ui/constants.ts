import { cva } from "class-variance-authority";

type ButtonShape = "default" | "icon";
type ButtonVariant = "danger" | "default" | "ghost" | "primary" | "warning";
type BadgeVariant = "default" | "destructive" | "primary" | "success" | "warning";

// Hover styles are scoped with `enabled:` so the disabled treatment (dashed, hollow, faint) always wins.
const buttonBaseClassName: string = [
  "inline-flex h-5 shrink-0 items-center justify-center gap-1 rounded-sm border text-md whitespace-nowrap select-none",
  "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  "aria-pressed:border-transparent aria-pressed:bg-primary aria-pressed:font-semibold aria-pressed:text-primary-foreground",
  "disabled:cursor-not-allowed disabled:border-dashed disabled:border-border disabled:bg-transparent",
  "disabled:font-normal disabled:text-faint",
].join(" ");

const buttonShapeClassNames: Record<ButtonShape, string> = {
  default: "px-1.5",
  icon: "w-5 p-0",
};

const buttonVariantClassNames: Record<ButtonVariant, string> = {
  danger:
    "border-destructive bg-transparent text-destructive enabled:hover:bg-destructive enabled:hover:text-destructive-foreground",
  default: "border-border bg-secondary text-foreground enabled:hover:border-faint enabled:hover:bg-accent",
  ghost:
    "border-transparent bg-transparent text-muted-foreground enabled:hover:bg-accent enabled:hover:text-foreground",
  primary: "border-transparent bg-primary font-semibold text-primary-foreground enabled:hover:brightness-110",
  warning: "border-transparent bg-warning font-semibold text-warning-foreground enabled:hover:brightness-110",
};

export const buttonVariants = cva(buttonBaseClassName, {
  defaultVariants: {
    shape: "default",
    variant: "default",
  },
  variants: {
    shape: buttonShapeClassNames,
    variant: buttonVariantClassNames,
  },
});

const badgeVariantClassNames: Record<BadgeVariant, string> = {
  default: "border-border text-muted-foreground",
  destructive: "border-transparent bg-destructive font-semibold text-destructive-foreground",
  primary: "border-transparent bg-primary font-semibold text-primary-foreground",
  success: "border-transparent bg-success font-semibold text-success-foreground",
  warning: "border-transparent bg-warning font-semibold text-warning-foreground",
};

export const badgeVariants = cva(
  "inline-flex h-4 w-fit shrink-0 items-center gap-1 rounded-sm border px-1 text-sm whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    defaultVariants: {
      variant: "default",
    },
    variants: {
      variant: badgeVariantClassNames,
    },
  },
);
