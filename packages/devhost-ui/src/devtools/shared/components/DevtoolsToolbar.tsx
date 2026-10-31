import { useLayoutEffect, useRef, useState, type JSX, type ReactNode } from "react";

import { cn } from "../../../lib/utils";
import type { DevtoolsPosition } from "../devtoolsConfig";

interface IDevtoolsToolbarProps {
  children: ReactNode;
  collapsedIndicator: ReactNode;
  readout?: ReactNode;
  isMinimapVisible: boolean;
  position: DevtoolsPosition;
  stackName: string;
  /** Reports how far the toolbar's segments reach from their viewport edge, where toolbar popups start. */
  onEdgeInsetChange?: (inset: number) => void;
}

/**
 * The single devtools toolbar anchored to the configured corner. Feature segments render as children; toolbar
 * popovers read `data-position` to open above (bottom-right) or below (top-right) their trigger.
 */
export function DevtoolsToolbar(props: IDevtoolsToolbarProps): JSX.Element {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const toggleLabel: string = `${isCollapsed ? "Expand" : "Collapse"} devhost toolbar`;
  const edgeReference = useRef<HTMLButtonElement | null>(null);
  const { onEdgeInsetChange, position } = props;
  useLayoutEffect(() => {
    const edge = edgeReference.current;
    if (edge === null || onEdgeInsetChange === undefined) return;
    const report = (): void => {
      const { top, bottom } = edge.getBoundingClientRect();
      onEdgeInsetChange(position === "top-right" ? bottom : document.documentElement.clientHeight - top);
    };
    report();
    // Segments can wrap onto a second row, and a resize moves the bottom edge without resizing the toolbar.
    const resizes = new ResizeObserver(report);
    if (edge.parentElement !== null) resizes.observe(edge.parentElement);
    window.addEventListener("resize", report);
    return () => {
      resizes.disconnect();
      window.removeEventListener("resize", report);
    };
  }, [onEdgeInsetChange, position]);

  return (
    <div
      className={cn(
        "group/toolbar pointer-events-auto fixed z-(--devhost-z-dock) flex max-h-[calc(100vh-var(--spacing)*4)] items-end gap-1",
        props.position === "top-right" ? "flex-col" : "flex-col-reverse",
        props.position === "top-right" ? "top-2" : "bottom-2",
        props.isMinimapVisible
          ? "right-[calc(var(--devhost-minimap-collapsed-width)+var(--spacing)*2)] max-w-[calc(100vw-var(--devhost-minimap-collapsed-width)-var(--spacing)*4)]"
          : "right-2 max-w-[calc(100vw-var(--spacing)*4)]",
      )}
      data-position={props.position}
      data-devhost-capture-exclude=""
      data-testid="DevtoolsToolbar"
    >
      <div
        aria-label="devhost"
        className="flex min-h-6.5 max-w-full shrink-0 flex-wrap items-stretch overflow-hidden rounded-md border border-edge bg-card text-card-foreground shadow-frame"
        data-testid="DevtoolsToolbar--bar"
        role="toolbar"
      >
        <button
          ref={edgeReference}
          aria-expanded={!isCollapsed}
          aria-label={toggleLabel}
          className="flex min-h-6 max-w-full shrink-0 items-center gap-1 px-1 enabled:hover:bg-secondary"
          data-testid="DevtoolsToolbar--collapse"
          title={`${toggleLabel} (${props.stackName})`}
          type="button"
          onClick={(): void => {
            setIsCollapsed((currentValue: boolean): boolean => !currentValue);
          }}
        >
          <span
            aria-hidden="true"
            className="grid size-4 shrink-0 place-items-center rounded-sm bg-foreground text-[10px] font-bold tracking-tight text-background"
          >
            dh
          </span>
          {isCollapsed ? null : <span className="truncate">{props.stackName}</span>}
        </button>
        {isCollapsed ? (
          <span
            className="flex items-center border-l border-border px-1"
            data-testid="DevtoolsToolbar--collapsed-indicator"
          >
            {props.collapsedIndicator}
          </span>
        ) : (
          props.children
        )}
      </div>
      {!isCollapsed && props.readout !== undefined ? (
        <div
          className="flex max-h-[calc(100vh-var(--spacing)*12)] min-h-0 w-96 max-w-full flex-col gap-1 overflow-auto rounded-md"
          data-testid="DevtoolsToolbar--readout"
        >
          {props.readout}
        </div>
      ) : null}
    </div>
  );
}
