import { cn } from "../../lib/utils";

export function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      data-testid="Kbd"
      className={cn(
        "pointer-events-none inline-flex h-3.5 w-fit items-center justify-center rounded-sm border border-current px-[3px] font-mono text-sm leading-none opacity-80 select-none",
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
      className={cn("inline-flex items-center gap-0.5", className)}
      {...props}
    />
  );
}
