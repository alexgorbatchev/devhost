import * as React from "react";

type OmitKeys = "className" | "style";

interface ICardProps extends Omit<React.ComponentProps<"div">, OmitKeys> {
  size?: "default" | "sm";
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
      className="group/card flex flex-col gap-4 overflow-hidden rounded-md bg-card py-4 text-sm text-card-foreground ring-1 ring-foreground/10 has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:gap-3 data-[size=sm]:py-3 data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-md *:[img:last-child]:rounded-b-md"
      {...props}
    />
  );
});

export function CardHeader({ ...props }: Omit<React.ComponentProps<"div">, OmitKeys>): React.ReactElement {
  return (
    <div
      data-slot="card-header"
      data-testid="CardHeader"
      className="group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-md px-4 group-data-[size=sm]/card:px-3 has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-4 group-data-[size=sm]/card:[.border-b]:pb-3"
      {...props}
    />
  );
}

export function CardTitle({ ...props }: Omit<React.ComponentProps<"div">, OmitKeys>): React.ReactElement {
  return (
    <div
      data-slot="card-title"
      data-testid="CardTitle"
      className="font-heading text-base leading-snug font-medium group-data-[size=sm]/card:text-sm"
      {...props}
    />
  );
}

export function CardDescription({ ...props }: Omit<React.ComponentProps<"div">, OmitKeys>): React.ReactElement {
  return (
    <div
      data-slot="card-description"
      data-testid="CardDescription"
      className="text-sm text-muted-foreground"
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
      className="px-4 group-data-[size=sm]/card:px-3"
      {...props}
    />
  );
}

export function CardFooter({ ...props }: Omit<React.ComponentProps<"div">, OmitKeys>): React.ReactElement {
  return (
    <div
      data-slot="card-footer"
      data-testid="CardFooter"
      className="flex items-center rounded-b-md border-t bg-muted/50 p-4 group-data-[size=sm]/card:p-3"
      {...props}
    />
  );
}
