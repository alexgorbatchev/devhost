import { type ButtonHTMLAttributes, type JSX, type ReactNode } from "react";

type ButtonSize = "medium" | "large";
type ButtonVariant = "primary" | "secondary";

export interface IButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  size?: ButtonSize;
  variant?: ButtonVariant;
}

const baseButtonClassName: string = [
  "inline-flex items-center justify-center rounded-md border px-4 text-sm shadow-[var(--shadow-soft)] transition",
  "disabled:cursor-not-allowed disabled:opacity-50",
].join(" ");

const buttonSizeClassNames: Record<ButtonSize, string> = {
  large: "h-11",
  medium: "h-10",
};

const buttonVariantClassNames: Record<ButtonVariant, string> = {
  primary: [
    "border-transparent bg-primary font-medium text-primary-foreground",
    "hover:-translate-y-px hover:shadow-[var(--shadow-raised)]",
  ].join(" "),
  secondary: [
    "border-border-subtle bg-card text-foreground",
    "hover:border-border-strong hover:bg-surface-subtle",
  ].join(" "),
};

export function Button(props: IButtonProps): JSX.Element {
  const { children, className, size = "medium", type = "button", variant = "secondary", ...buttonProps } = props;
  const resolvedClassName = [
    baseButtonClassName,
    buttonSizeClassNames[size],
    buttonVariantClassNames[variant],
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button {...buttonProps} className={resolvedClassName} data-testid="Button" type={type}>
      {children}
    </button>
  );
}
