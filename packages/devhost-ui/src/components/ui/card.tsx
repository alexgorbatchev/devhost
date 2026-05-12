import * as React from "react";

import { cn } from "@/lib/utils";

interface ICardProps extends React.ComponentProps<"div"> {
  size?: "default" | "sm";
}

export function Card({ className, size = "default", ...props }: ICardProps): React.ReactElement {
  return (
    <div
      data-size={size}
      data-slot="card"
      data-testid="Card"
      className={cn(
        "flex flex-col gap-4 overflow-hidden rounded-xl bg-card py-4 text-sm text-card-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      data-slot="card-header"
      data-testid="CardHeader"
      className={cn("grid auto-rows-min items-start gap-1 px-4", className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      data-slot="card-title"
      data-testid="CardTitle"
      className={cn("text-base leading-snug font-medium", className)}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      data-slot="card-description"
      data-testid="CardDescription"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export function CardAction({ className, ...props }: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      data-slot="card-action"
      data-testid="CardAction"
      className={cn("self-start justify-self-end", className)}
      {...props}
    />
  );
}

export function CardContent({ className, ...props }: React.ComponentProps<"div">): React.ReactElement {
  return <div data-slot="card-content" data-testid="CardContent" className={cn("px-4", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      data-slot="card-footer"
      data-testid="CardFooter"
      className={cn("flex items-center border-t bg-muted/50 p-4", className)}
      {...props}
    />
  );
}
