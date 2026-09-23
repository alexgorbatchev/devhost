import * as React from "react";

type OmitKeys = "className" | "style";

type CardProps = Omit<React.ComponentProps<"div">, OmitKeys>;

/**
 * The devtools "frame": an opaque surface with an inner edge of opposite lightness and an outer halo ring, so it
 * stays distinguishable on any host background (see `--shadow-frame` in devtools.css).
 */
export const Card = React.forwardRef<HTMLDivElement, CardProps>(function Card(
  props: CardProps,
  reference,
): React.ReactElement {
  return (
    <div
      ref={reference}
      data-slot="card"
      data-testid="Card"
      className="flex flex-col overflow-hidden rounded-md border border-edge bg-card text-card-foreground shadow-frame"
      {...props}
    />
  );
});

export function CardHeader(props: CardProps): React.ReactElement {
  return (
    <div
      data-slot="card-header"
      data-testid="CardHeader"
      className="flex h-6 shrink-0 items-center gap-1.5 border-b border-border pr-1 pl-2"
      {...props}
    />
  );
}

export function CardTitle(props: CardProps): React.ReactElement {
  return (
    <div data-slot="card-title" data-testid="CardTitle" className="min-w-0 flex-1 truncate font-bold" {...props} />
  );
}

export function CardContent(props: CardProps): React.ReactElement {
  return <div data-slot="card-content" data-testid="CardContent" className="grid gap-1.5 px-2 py-1.5" {...props} />;
}
