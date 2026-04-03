import type { CSSObject } from "@emotion/css/create-instance";
import type { JSX } from "preact";
import { useMemo, useState } from "preact/hooks";

import { css, type IDevtoolsTheme, useDevtoolsTheme } from "../../shared";
import type { IComponentSourceMenuItem } from "./types";

interface IComponentSourceMenuProps {
  items: IComponentSourceMenuItem[];
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
const itemInteractiveSelector: string = "&:is(:hover, :focus-visible)";

export function ComponentSourceMenu({ items, position, title, errorMessage, onItemClick }: IComponentSourceMenuProps): JSX.Element | null {
  const theme = useDevtoolsTheme();
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
  const menuClassName: string = css(createMenuStyle(theme, menuPosition.left, menuPosition.top));
  const headerClassName: string = css(headerStyle);
  const titleClassName: string = css(titleStyle);
  const listClassName: string = css(listStyle);
  const errorClassName: string = css(createErrorStyle(theme));

  if (items.length === 0) {
    return null;
  }

  return (
    <div class={menuClassName} data-component-source-menu="" data-testid="ComponentSourceMenu">
      <header class={headerClassName}>
        <strong class={titleClassName}>{title}</strong>
        {errorMessage !== undefined ? (
          <div class={errorClassName} role="alert">
            {errorMessage}
          </div>
        ) : null}
      </header>
      <div class={listClassName}>
        {items.map((item: IComponentSourceMenuItem, index: number) => {
          const itemClassName: string = css(createItemStyle(theme, hoveredItemIndex === index));
          const propsClassName: string = css(propsRowStyle);
          const sourceClassName: string = css(createSourceLabelStyle(theme));

          return (
            <button
              key={item.key}
              class={itemClassName}
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
                <div class={propsClassName}>
                  {item.props.map((prop) => {
                    const propClassName: string = css(createPropPillStyle(theme));

                    return (
                      <span
                        key={`${item.key}-${prop.name}`}
                        class={propClassName}
                        title={prop.title}
                      >
                        {prop.name}
                      </span>
                    );
                  })}
                </div>
              ) : null}
              <span class={sourceClassName} title={item.sourceLabel}>
                {item.sourceLabel}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const headerStyle: CSSObject = {
  display: "grid",
  gap: "4px",
};

const listStyle: CSSObject = {
  display: "grid",
  gap: "8px",
};

const propsRowStyle: CSSObject = {
  display: "flex",
  flexWrap: "wrap",
  gap: "6px",
};

const titleStyle: CSSObject = {
  lineHeight: 1.25,
};

function createErrorStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    background: theme.colors.dangerBackground,
    border: `1px solid ${theme.colors.dangerForeground}`,
    borderRadius: theme.radii.sm,
    color: theme.colors.dangerForeground,
    fontSize: theme.fontSizes.sm,
    lineHeight: 1.4,
    padding: theme.spacing.xs,
  };
}

function createMenuStyle(theme: IDevtoolsTheme, left: number, top: number): CSSObject {
  return {
    background: theme.colors.background,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.md,
    boxShadow: theme.shadows.popup,
    color: theme.colors.foreground,
    display: "grid",
    gap: theme.spacing.xs,
    left,
    maxWidth: `${menuWidthInPixels}px`,
    minWidth: `${menuWidthInPixels}px`,
    padding: theme.spacing.xs,
    position: "fixed",
    top,
    zIndex: Number(theme.zIndices.floating) + 1,
  };
}

function createItemStyle(theme: IDevtoolsTheme, isHovered: boolean): CSSObject {
  const hoveredStyle: CSSObject = {
    background: theme.colors.selectionBackground,
    borderColor: theme.colors.selectionBorder,
  };

  return {
    [itemInteractiveSelector]: hoveredStyle,
    alignItems: "flex-start",
    background: isHovered ? theme.colors.selectionBackground : theme.colors.logMinimapBackground,
    border: `1px solid ${isHovered ? theme.colors.selectionBorder : theme.colors.border}`,
    borderRadius: theme.radii.md,
    color: theme.colors.foreground,
    cursor: "pointer",
    display: "grid",
    fontFamily: theme.fontFamilies.body,
    fontSize: theme.fontSizes.md,
    gap: theme.spacing.xxs,
    justifyItems: "stretch",
    padding: theme.spacing.xs,
    textAlign: "left",
    width: "100%",
  };
}

function createPropPillStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    background: theme.colors.logMinimapOverlayBackground,
    borderRadius: theme.radii.pill,
    color: theme.colors.mutedForeground,
    fontFamily: theme.fontFamilies.monospace,
    fontSize: theme.fontSizes.sm,
    lineHeight: 1,
    padding: `${theme.spacing.xxs} ${theme.spacing.xs}`,
  };
}

function createSourceLabelStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    color: theme.colors.mutedForeground,
    fontFamily: theme.fontFamilies.monospace,
    fontSize: theme.fontSizes.sm,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };
}
