import * as React from "react";

import { cn } from "../../lib/utils";

type OmitKeys = "className" | "style";

interface ICardProps extends Omit<React.ComponentProps<"div">, OmitKeys> {
  size?: "default" | "sm" | "xs";
}

export const Card = React.forwardRef<HTMLDivElement, ICardProps>(function Card(
  { size = "default", ...props }: ICardProps,
  reference,
): React.ReactElement {
  return (
    <div
      ref={reference}
      data-size={size}
      data-slot="card"
      data-testid="Card"
      className="group/card flex flex-col overflow-hidden rounded-md bg-card text-card-foreground ring-1 ring-foreground/10
        data-[size=default]:gap-4 data-[size=default]:py-4 data-[size=default]:text-sm
        data-[size=sm]:gap-3 data-[size=sm]:py-3 data-[size=sm]:text-sm
        data-[size=xs]:gap-2 data-[size=xs]:py-2 data-[size=xs]:text-xs
        has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0
        *:[img:first-child]:rounded-t-md *:[img:last-child]:rounded-b-md"
      {...props}
    />
  );
});

interface ICardHeaderProps extends Omit<React.ComponentProps<"div">, OmitKeys> {
  bordered?: boolean;
}

export function CardHeader({ bordered = false, ...props }: ICardHeaderProps): React.ReactElement {
  return (
    <div
      data-slot="card-header"
      data-testid="CardHeader"
      className={cn(
        "group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-md px-4 group-data-[size=sm]/card:px-3 group-data-[size=xs]/card:px-3 group-data-[size=sm]/card:py-2 group-data-[size=xs]/card:py-2 group-data-[size=sm]/card:gap-2 group-data-[size=xs]/card:gap-2 has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-4 group-data-[size=sm]/card:[.border-b]:pb-3 group-data-[size=xs]/card:[.border-b]:pb-2",
        bordered && "border-b pb-2",
      )}
      {...props}
    />
  );
}

export function CardTitle({ ...props }: Omit<React.ComponentProps<"div">, OmitKeys>): React.ReactElement {
  return (
    <div
      data-slot="card-title"
      data-testid="CardTitle"
      className="font-heading text-base leading-snug font-medium group-data-[size=sm]/card:text-sm group-data-[size=xs]/card:text-xs"
      {...props}
    />
  );
}

export function CardDescription({ ...props }: Omit<React.ComponentProps<"div">, OmitKeys>): React.ReactElement {
  return (
    <div
      data-slot="card-description"
      data-testid="CardDescription"
      className="text-sm text-muted-foreground group-data-[size=xs]/card:text-[10px]"
      {...props}
    />
  );
}

export function CardAction({ ...props }: Omit<React.ComponentProps<"div">, OmitKeys>): React.ReactElement {
  return (
    <div
      data-slot="card-action"
      data-testid="CardAction"
      className="col-start-2 row-span-2 row-start-1 self-start justify-self-end"
      {...props}
    />
  );
}

export function CardContent({ ...props }: Omit<React.ComponentProps<"div">, OmitKeys>): React.ReactElement {
  return (
    <div
      data-slot="card-content"
      data-testid="CardContent"
      className="px-4 group-data-[size=sm]/card:px-3 group-data-[size=xs]/card:px-3 group-data-[size=sm]/card:py-2 group-data-[size=xs]/card:py-2"
      {...props}
    />
  );
}

export function CardFooter({ ...props }: Omit<React.ComponentProps<"div">, OmitKeys>): React.ReactElement {
  return (
    <div
      data-slot="card-footer"
      data-testid="CardFooter"
      className="flex items-center rounded-b-md border-t bg-muted/50 p-4 group-data-[size=sm]/card:p-3 group-data-[size=xs]/card:p-2"
      {...props}
    />
  );
}
