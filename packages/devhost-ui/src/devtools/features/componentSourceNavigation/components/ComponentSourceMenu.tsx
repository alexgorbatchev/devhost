import type { JSX } from "react";
import { useMemo } from "react";

import { Badge } from "../../../../components/ui/Badge";
import { Card, CardHeader, CardTitle } from "../../../../components/ui/Card";

import { InlineNotice } from "../../../shared";
import type { ComponentSourceMenuItem } from "../types";

interface IComponentSourceMenuProps {
  errorMessage?: string;
  isOpen: boolean;
  items: ComponentSourceMenuItem[];
  onItemClick: (index: number) => void;
  position: {
    x: number;
    y: number;
  };
  title: string;
}

const menuWidthInPixels: number = 400;
const menuViewportPaddingInPixels: number = 10;
const menuHeaderHeightInPixels: number = 26;
const menuErrorHeightInPixels: number = 28;
const menuPerItemHeightInPixels: number = 44;

/**
 * Chooser shown on Alt + right-click listing the component chain under the pointer. It stays mounted while it
 * fades out; the owner keeps passing the last menu contents with `isOpen` false.
 */
export function ComponentSourceMenu({
  errorMessage,
  isOpen,
  items,
  onItemClick,
  position,
  title,
}: IComponentSourceMenuProps): JSX.Element | null {
  const menuPosition = useMemo(() => {
    const maxLeft: number = Math.max(
      menuViewportPaddingInPixels,
      window.innerWidth - menuWidthInPixels - menuViewportPaddingInPixels,
    );
    const estimatedMenuHeight: number =
      menuHeaderHeightInPixels +
      (errorMessage === undefined ? 0 : menuErrorHeightInPixels) +
      items.length * menuPerItemHeightInPixels;
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
    <section
      aria-label={title}
      className="devhost-fade pointer-events-auto fixed z-(--devhost-z-popover) w-100 max-w-[calc(100vw-20px)]"
      data-component-source-menu=""
      data-testid="ComponentSourceMenu"
      hidden={!isOpen}
      inert={!isOpen}
      style={{ left: menuPosition.left, top: menuPosition.top }}
    >
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        {errorMessage !== undefined ? <InlineNotice tone="danger">{errorMessage}</InlineNotice> : null}
        <div className="max-h-[min(60vh,480px)] overflow-auto">
          {items.map((item: ComponentSourceMenuItem, index: number) => {
            return (
              <button
                key={item.key}
                className="grid w-full gap-0.5 px-2 py-1 text-left not-first:border-t hover:bg-secondary hover:shadow-[inset_2px_0_0_var(--primary)] focus-visible:bg-secondary focus-visible:shadow-[inset_2px_0_0_var(--primary)] focus-visible:outline-none"
                data-testid="ComponentSourceMenu--item"
                type="button"
                onClick={(): void => {
                  onItemClick(index);
                }}
              >
                <span className="flex flex-wrap items-center gap-1">
                  <span className="text-lg font-bold">{`<${item.displayName}>`}</span>
                  {item.props.map((prop) => {
                    return (
                      <Badge key={`${item.key}-${prop.name}`} title={prop.title}>
                        {prop.name}
                      </Badge>
                    );
                  })}
                </span>
                {/* Truncates from the left so the file name and line stay visible for long paths. */}
                <span className="truncate text-sm text-muted-foreground [direction:rtl]" title={item.sourceLabel}>
                  {item.sourceLabel}
                </span>
              </button>
            );
          })}
        </div>
      </Card>
    </section>
  );
}
