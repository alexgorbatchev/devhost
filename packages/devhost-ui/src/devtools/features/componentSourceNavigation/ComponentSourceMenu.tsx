import type { CSSProperties, JSX } from "react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import type { ComponentSourceMenuItem } from "./types";

interface IComponentSourceMenuProps {
  items: ComponentSourceMenuItem[];
  position: {
    x: number;
    y: number;
  };
  title: string;
  errorMessage?: string;
  onItemClick: (index: number) => void;
}

interface IComponentSourceMenuPositionStyle extends CSSProperties {
  left: number;
  top: number;
}

const menuWidthInPixels: number = 420;
const menuViewportPaddingInPixels: number = 16;
const menuPerItemHeightInPixels: number = 88;

export function ComponentSourceMenu({
  items,
  position,
  title,
  errorMessage,
  onItemClick,
}: IComponentSourceMenuProps): JSX.Element | null {
  const [hoveredItemIndex, setHoveredItemIndex] = useState<number | null>(null);
  const menuPosition = useMemo(() => {
    const maxLeft: number = Math.max(
      menuViewportPaddingInPixels,
      window.innerWidth - menuWidthInPixels - menuViewportPaddingInPixels,
    );
    const errorMessageHeightInPixels: number = errorMessage === undefined ? 0 : 56;
    const estimatedMenuHeight: number = 64 + errorMessageHeightInPixels + items.length * menuPerItemHeightInPixels;
    const maxTop: number = Math.max(
      menuViewportPaddingInPixels,
      window.innerHeight - estimatedMenuHeight - menuViewportPaddingInPixels,
    );

    return {
      left: Math.min(position.x, maxLeft),
      top: Math.min(position.y, maxTop),
    };
  }, [errorMessage, items.length, position.x, position.y]);

  if (items.length === 0) {
    return null;
  }

  const menuPositionStyle: IComponentSourceMenuPositionStyle = {
    left: menuPosition.left,
    top: menuPosition.top,
  };

  return (
    <Card
      className="fixed z-[2147483501] grid min-w-[420px] max-w-[420px] gap-2 p-2 shadow-lg"
      data-component-source-menu=""
      data-testid="ComponentSourceMenu"
      style={menuPositionStyle}
    >
      <CardHeader className="gap-1 p-0">
        <CardTitle className="leading-tight">{title}</CardTitle>
        {errorMessage !== undefined ? (
          <div
            className="rounded-sm border border-destructive bg-destructive/10 p-2 text-xs leading-normal text-destructive"
            role="alert"
          >
            {errorMessage}
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="grid gap-2 p-0">
        {items.map((item: ComponentSourceMenuItem, index: number) => {
          const isHovered: boolean = hoveredItemIndex === index;

          return (
            <button
              key={item.key}
              className={cn(
                "grid w-full cursor-pointer justify-stretch gap-1 rounded-md border bg-muted p-2 text-left",
                "text-sm text-foreground transition-colors hover:border-primary hover:bg-accent",
                "focus-visible:border-primary focus-visible:bg-accent focus-visible:outline-none",
                isHovered ? "border-primary bg-accent" : "border-border",
              )}
              data-testid="ComponentSourceMenu--item"
              type="button"
              onClick={(): void => {
                onItemClick(index);
              }}
              onFocus={(): void => {
                setHoveredItemIndex(index);
              }}
              onBlur={(): void => {
                setHoveredItemIndex((currentIndex: number | null): number | null => {
                  return currentIndex === index ? null : currentIndex;
                });
              }}
              onMouseEnter={(): void => {
                setHoveredItemIndex(index);
              }}
              onMouseLeave={(): void => {
                setHoveredItemIndex((currentIndex: number | null): number | null => {
                  return currentIndex === index ? null : currentIndex;
                });
              }}
            >
              <strong>{`<${item.displayName}>`}</strong>
              {item.props.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {item.props.map((prop) => {
                    return (
                      <Badge key={`${item.key}-${prop.name}`} title={prop.title} variant="secondary">
                        {prop.name}
                      </Badge>
                    );
                  })}
                </div>
              ) : null}
              <span className="truncate text-xs text-muted-foreground" title={item.sourceLabel}>
                {item.sourceLabel}
              </span>
            </button>
          );
        })}
      </CardContent>
    </Card>
  );
}
