import type { JSX } from "react";
import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { FloatingPanel, InlineNotice } from "../../shared";
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

  return (
    <FloatingPanel
      className="min-w-[420px] max-w-[420px] gap-2 p-2"
      data-component-source-menu=""
      level="raised"
      position="fixed"
      style={{ left: menuPosition.left, top: menuPosition.top }}
      testId="ComponentSourceMenu"
    >
      <CardHeader className="gap-1 p-0">
        <CardTitle className="leading-tight">{title}</CardTitle>
        {errorMessage !== undefined ? <InlineNotice tone="danger">{errorMessage}</InlineNotice> : null}
      </CardHeader>
      <CardContent className="grid gap-2 p-0">
        {items.map((item: ComponentSourceMenuItem, index: number) => {
          return (
            <button
              key={item.key}
              className="grid w-full justify-stretch gap-1 rounded-md border border-border bg-muted p-2 text-left text-sm text-foreground transition-colors hover:border-primary hover:bg-accent focus-visible:border-primary focus-visible:bg-accent focus-visible:outline-none"
              data-testid="ComponentSourceMenu--item"
              type="button"
              onClick={(): void => {
                onItemClick(index);
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
    </FloatingPanel>
  );
}
