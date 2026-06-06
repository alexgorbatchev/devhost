import type { JSX } from "react";
import { useMemo } from "react";

import { Badge } from "../../../../components/ui/Badge";

import { FloatingPanel, InlineNotice } from "../../../shared";
import type { ComponentSourceMenuItem } from "../types";

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
    <div
      className="fixed z-[var(--devhost-z-floating-raised)] min-w-[420px] max-w-[420px]"
      data-component-source-menu=""
      data-testid="ComponentSourceMenu"
      style={{ left: menuPosition.left, top: menuPosition.top }}
    >
      <FloatingPanel level="raised" position="fixed">
        <div className="grid gap-2 p-2">
          <div
            data-slot="card-header"
            className="group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-md px-4 group-data-[size=sm]/card:px-3 has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-4 group-data-[size=sm]/card:[.border-b]:pb-3 p-0"
          >
            <div
              data-slot="card-title"
              className="font-heading text-base font-medium group-data-[size=sm]/card:text-sm leading-tight"
            >
              {title}
            </div>
            {errorMessage !== undefined ? <InlineNotice tone="danger">{errorMessage}</InlineNotice> : null}
          </div>
          <div data-slot="card-content" className="px-4 group-data-[size=sm]/card:px-3 grid gap-2 p-0">
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
          </div>
        </div>
      </FloatingPanel>
    </div>
  );
}
