import type { JSX, ReactNode } from "react";
import { useState } from "react";

import { Card } from "@/components/ui/card";

import { resolveHoverSlidePanelTransform } from "./resolveHoverSlidePanelTransform";

interface IHoverSlidePanelProps {
  ariaLabel: string;
  children: ReactNode;
  isPinned?: boolean;
  peekWidth: string;
  testId?: string;
}

export function HoverSlidePanel({
  ariaLabel,
  children,
  isPinned = false,
  peekWidth,
  testId,
}: IHoverSlidePanelProps): JSX.Element {
  const [isHovered, setIsHovered] = useState<boolean>(false);
  const transform: string = resolveHoverSlidePanelTransform(isHovered || isPinned, peekWidth);

  return (
    <Card
      aria-label={ariaLabel}
      className="relative z-[2147483502] overflow-visible px-2 py-1 text-xs shadow-sm transition-transform duration-150 ease-in-out after:absolute after:inset-y-0 after:-right-[50px] after:w-[50px] after:content-['']"
      data-testid={testId !== undefined ? testId : "HoverSlidePanel"}
      style={{ transform }}
      onMouseEnter={(): void => {
        setIsHovered(true);
      }}
      onMouseLeave={(): void => {
        setIsHovered(false);
      }}
    >
      {children}
    </Card>
  );
}
