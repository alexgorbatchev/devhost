import { PortalProvider } from "@alexgorbatchev/shadcn";
import { useId, useRef, useState, type JSX, type ReactNode, type Ref, type ToggleEvent } from "react";

import { cn } from "../../../lib/utils";

type ToolbarPopoverTriggerAppearance = "button" | "segment";
type ToolbarPopoverTriggerTone = "alert" | "default";
type ToolbarPopoverWidth = "lg" | "md" | "sm";

interface IToolbarPopoverProps {
  children: ReactNode;
  headerEndEnhancer?: ReactNode;
  notice?: ReactNode;
  onOpenChange?: (isOpen: boolean) => void;
  panelLabel: string;
  panelWidth: ToolbarPopoverWidth;
  testId: string;
  title?: string;
  triggerAppearance?: ToolbarPopoverTriggerAppearance;
  triggerContent: ReactNode;
  triggerLabel: string;
  /** The trigger button, for a toolbar segment that measures how much room the trigger takes. */
  triggerReference?: Ref<HTMLButtonElement>;
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
  onOpenChange,
  panelLabel,
  panelWidth,
  testId,
  title,
  triggerAppearance = "segment",
  triggerContent,
  triggerLabel,
  triggerReference,
  triggerTone = "default",
}: IToolbarPopoverProps): JSX.Element {
  const panelId: string = useId();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  // Library popups opened from the panel, such as a select list, render inside it: a click there is inside the
  // native popover, so it does not light-dismiss the panel.
  const portalReference = useRef<HTMLDivElement | null>(null);

  return (
    <span className="contents" data-testid="ToolbarPopover">
      <button
        ref={triggerReference}
        aria-expanded={isOpen}
        aria-label={triggerLabel}
        className={cn(
          "flex min-h-5 max-w-full shrink-0 items-center gap-1.5 whitespace-nowrap enabled:hover:bg-secondary",
          triggerAppearance === "segment"
            ? "min-h-6 border-l border-border px-2 aria-expanded:bg-accent aria-expanded:shadow-[inset_0_-2px_0_var(--primary)] group-data-[position=top-right]/toolbar:aria-expanded:shadow-[inset_0_2px_0_var(--primary)]"
            : "h-5 rounded-sm border border-border bg-secondary px-1.5 aria-expanded:border-primary aria-expanded:shadow-[inset_0_0_0_1px_var(--primary)]",
          triggerTone === "alert" && "font-semibold",
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
          if (event.target !== event.currentTarget) return;
          setIsOpen(event.newState === "open");
          onOpenChange?.(event.newState === "open");
        }}
      >
        <PortalProvider container={portalReference}>
          <header className="flex h-6 shrink-0 items-center gap-1.5 border-b border-border pr-1 pl-2 font-bold">
            <span className="min-w-0 flex-1 truncate">{panelLabel}</span>
            {headerEndEnhancer}
          </header>
          {notice}
          <div className="min-h-0 overflow-auto">{children}</div>
        </PortalProvider>
        <div ref={portalReference} />
      </section>
    </span>
  );
}
