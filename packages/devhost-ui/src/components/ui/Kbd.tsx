import { cn } from "../../lib/utils";

interface IKbdProps extends React.ComponentProps<"kbd"> {
  tone?: "muted" | "on-color";
}

export function Kbd({ className, tone = "muted", ...props }: IKbdProps) {
  return (
    <kbd
      data-slot="kbd"
      data-testid="Kbd"
      className={cn(
        "pointer-events-none inline-flex h-3.5 w-fit shrink-0 items-center justify-center rounded-sm border border-current px-[3px] font-mono text-sm leading-none font-normal whitespace-nowrap select-none",
        tone === "muted" ? "text-muted-foreground" : "opacity-85",
        className,
      )}
      {...props}
    />
  );
}

export function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <kbd
      data-slot="kbd-group"
      data-testid="KbdGroup"
      className={cn("inline-flex shrink-0 flex-nowrap items-center gap-0.5 whitespace-nowrap", className)}
      {...props}
    />
  );
}
