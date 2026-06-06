import type { JSX, ReactNode } from "react";
import { useState } from "react";

import { cn } from "../../../lib/utils";

import { InlineNotice } from "./InlineNotice";

interface IHoverSlidePanelProps {
  actions?: ReactNode;
  ariaLabel: string;
  children: ReactNode;
  description?: ReactNode;
  endEnhancer?: ReactNode;
  error?: ReactNode;
  isPinned?: boolean;
  startEnhancer?: ReactNode;
  testId?: string;
  title?: ReactNode;
}

export function HoverSlidePanel({
  actions,
  ariaLabel,
  children,
  description,
  endEnhancer,
  error,
  isPinned = false,
  startEnhancer,
  testId,
  title,
}: IHoverSlidePanelProps): JSX.Element {
  const [isHovered, setIsHovered] = useState<boolean>(false);
  const shouldRenderHeader: boolean =
    actions !== undefined ||
    description !== undefined ||
    endEnhancer !== undefined ||
    error !== undefined ||
    startEnhancer !== undefined ||
    title !== undefined;

  return (
    <div
      aria-label={ariaLabel}
      className={cn(
        "group/card flex flex-col gap-4 overflow-hidden rounded-md bg-card py-4 text-sm text-card-foreground ring-1 ring-foreground/10 has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:gap-3 data-[size=sm]:py-3 data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-md *:[img:last-child]:rounded-b-md",
        "relative z-[var(--devhost-z-floating-panel)] overflow-visible text-xs shadow-sm transition-transform duration-150 ease-in-out",
        "after:absolute after:inset-y-0 after:-right-[50px] after:w-[50px] after:content-['']",
      )}
      data-slot="card"
      data-testid={testId !== undefined ? testId : "HoverSlidePanel"}
      style={{
        transform:
          isHovered || isPinned ? "translateX(0)" : "translateX(calc(100% - var(--devhost-slide-panel-peek-width)))",
      }}
      onMouseEnter={(): void => {
        setIsHovered(true);
      }}
      onMouseLeave={(): void => {
        setIsHovered(false);
      }}
    >
      {shouldRenderHeader ? (
        <div
          data-slot="card-header"
          className={cn(
            "group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-md px-4 group-data-[size=sm]/card:px-3 has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-4 group-data-[size=sm]/card:[.border-b]:pb-3",
            "gap-2 border-b px-3 py-2",
          )}
        >
          {title !== undefined ||
          description !== undefined ||
          startEnhancer !== undefined ||
          endEnhancer !== undefined ? (
            <div className="flex items-start gap-2">
              {startEnhancer !== undefined ? <div aria-hidden="true">{startEnhancer}</div> : null}
              <div className="grid min-w-0 flex-1 gap-1">
                {title !== undefined ? (
                  <div
                    data-slot="card-title"
                    className="font-heading text-base leading-snug font-medium group-data-[size=sm]/card:text-sm"
                  >
                    {title}
                  </div>
                ) : null}
                {description !== undefined ? (
                  <div data-slot="card-description" className="text-sm text-muted-foreground">
                    {description}
                  </div>
                ) : null}
              </div>
              {actions !== undefined || endEnhancer !== undefined ? (
                <div className="flex shrink-0 items-center gap-2">
                  {actions}
                  {endEnhancer !== undefined ? <div aria-hidden="true">{endEnhancer}</div> : null}
                </div>
              ) : null}
            </div>
          ) : null}
          {error !== undefined ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
        </div>
      ) : null}
      <div data-slot="card-content" className={cn("px-4 group-data-[size=sm]/card:px-3", "px-3 py-2")}>
        {children}
      </div>
    </div>
  );
}
