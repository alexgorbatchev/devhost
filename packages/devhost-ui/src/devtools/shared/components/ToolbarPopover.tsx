import { useId, useState, type JSX, type ReactNode, type ToggleEvent } from "react";

import { cn } from "../../../lib/utils";
import { toolbarPopoverIdContext } from "../toolbarPopoverIdContext";

type ToolbarPopoverTriggerAppearance = "button" | "segment";
type ToolbarPopoverTriggerTone = "alert" | "default";
type ToolbarPopoverWidth = "lg" | "md" | "sm";

interface IToolbarPopoverProps {
  children: ReactNode;
  headerEndEnhancer?: ReactNode;
  notice?: ReactNode;
  panelLabel: string;
  panelWidth: ToolbarPopoverWidth;
  testId: string;
  title?: string;
  triggerAppearance?: ToolbarPopoverTriggerAppearance;
  triggerContent: ReactNode;
  triggerLabel: string;
  triggerTone?: ToolbarPopoverTriggerTone;
}

const panelWidthClassNames: Record<ToolbarPopoverWidth, string> = {
  lg: "w-110",
  md: "w-90",
  sm: "w-75",
};

/**
 * A toolbar trigger plus its panel, built on the native Popover API: the panel lives in the top layer (above any
 * host-page stacking), light-dismisses on outside click or Escape, and only one toolbar panel is open at a time.
 * CSS anchor positioning attaches the panel to its implicit anchor (the invoking button): above it for a
 * bottom-right toolbar, below it for a top-right toolbar, flipping inline near the viewport edge.
 */
export function ToolbarPopover({
  children,
  headerEndEnhancer,
  notice,
  panelLabel,
  panelWidth,
  testId,
  title,
  triggerAppearance = "segment",
  triggerContent,
  triggerLabel,
  triggerTone = "default",
}: IToolbarPopoverProps): JSX.Element {
  const panelId: string = useId();
  const [isOpen, setIsOpen] = useState<boolean>(false);

  return (
    <>
      <button
        aria-expanded={isOpen}
        aria-label={triggerLabel}
        className={cn(
          "flex shrink-0 items-center gap-1.5 whitespace-nowrap",
          triggerAppearance === "segment"
            ? "border-l border-border px-2 aria-expanded:bg-accent aria-expanded:shadow-[inset_0_-2px_0_var(--primary)] group-data-[position=top-right]/toolbar:aria-expanded:shadow-[inset_0_2px_0_var(--primary)]"
            : "h-5 rounded-sm border border-border bg-secondary px-1.5 aria-expanded:border-primary aria-expanded:shadow-[inset_0_0_0_1px_var(--primary)]",
          triggerTone === "alert"
            ? "bg-destructive font-semibold text-destructive-foreground enabled:hover:brightness-110"
            : "enabled:hover:bg-secondary",
        )}
        data-devhost-instance-testid={testId}
        data-testid="ToolbarPopover--trigger"
        popoverTarget={panelId}
        title={title}
        type="button"
      >
        {triggerContent}
      </button>
      <section
        aria-label={panelLabel}
        className={cn(
          "devhost-fade inset-auto m-0 my-1.5 flex max-h-[min(60vh,520px)] max-w-[calc(100vw-32px)] flex-col overflow-hidden p-0",
          "rounded-md border border-edge bg-card text-card-foreground shadow-frame",
          "[position-anchor:auto] [position-area:top_span-right] [position-try-fallbacks:flip-inline]",
          "group-data-[position=top-right]/toolbar:[position-area:bottom_span-right]",
          panelWidthClassNames[panelWidth],
        )}
        data-devhost-instance-testid={testId}
        data-testid="ToolbarPopover--panel"
        id={panelId}
        popover="auto"
        onToggle={(event: ToggleEvent<HTMLElement>): void => {
          setIsOpen(event.newState === "open");
        }}
      >
        <header className="flex h-6 shrink-0 items-center gap-1.5 border-b border-border pr-1 pl-2 font-bold">
          <span className="min-w-0 flex-1 truncate">{panelLabel}</span>
          {headerEndEnhancer}
        </header>
        {notice}
        <div className="min-h-0 overflow-auto">
          <toolbarPopoverIdContext.Provider value={panelId}>{children}</toolbarPopoverIdContext.Provider>
        </div>
      </section>
    </>
  );
}
