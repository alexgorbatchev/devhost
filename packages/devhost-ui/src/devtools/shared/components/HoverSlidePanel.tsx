import type { JSX, ReactNode } from "react";
import { useState } from "react";

import { cn } from "../../../lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/Card";

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
        "relative z-[var(--devhost-z-floating-panel)] overflow-visible text-xs shadow-sm transition-transform duration-150 ease-in-out",
        "after:absolute after:inset-y-0 after:-right-[50px] after:w-[50px] after:content-['']",
      )}
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
      <Card size="sm">
        {shouldRenderHeader ? (
          <CardHeader>
            <div className="border-b pb-2 gap-2 flex flex-col w-full">
              {title !== undefined ||
              description !== undefined ||
              startEnhancer !== undefined ||
              endEnhancer !== undefined ? (
                <div className="flex items-start gap-2">
                  {startEnhancer !== undefined ? <div aria-hidden="true">{startEnhancer}</div> : null}
                  <div className="grid min-w-0 flex-1 gap-1">
                    {title !== undefined ? <CardTitle>{title}</CardTitle> : null}
                    {description !== undefined ? <CardDescription>{description}</CardDescription> : null}
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
          </CardHeader>
        ) : null}
        <CardContent>
          <div className="py-2">{children}</div>
        </CardContent>
      </Card>
    </div>
  );
}
