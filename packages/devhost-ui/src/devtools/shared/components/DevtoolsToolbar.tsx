import { useState, type JSX, type ReactNode } from "react";

import { cn } from "../../../lib/utils";
import type { DevtoolsPosition } from "../devtoolsConfig";

interface IDevtoolsToolbarProps {
  children: ReactNode;
  collapsedIndicator: ReactNode;
  isMinimapVisible: boolean;
  position: DevtoolsPosition;
  stackName: string;
}

/**
 * The single devtools toolbar anchored to the configured corner. Feature segments render as children; toolbar
 * popovers read `data-position` to open above (bottom-right) or below (top-right) their trigger.
 */
export function DevtoolsToolbar(props: IDevtoolsToolbarProps): JSX.Element {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const toggleLabel: string = `${isCollapsed ? "Expand" : "Collapse"} devhost toolbar`;

  return (
    <div
      className={cn(
        "group/toolbar pointer-events-auto fixed z-(--devhost-z-dock) flex",
        props.position === "top-right" ? "top-2" : "bottom-2",
        props.isMinimapVisible ? "right-5 max-w-[calc(100vw-28px)]" : "right-2 max-w-[calc(100vw-16px)]",
      )}
      data-position={props.position}
      data-testid="DevtoolsToolbar"
    >
      <div
        aria-label="devhost"
        className="flex h-6.5 max-w-full items-stretch overflow-hidden rounded-md border border-edge bg-card text-card-foreground shadow-frame"
        data-testid="DevtoolsToolbar--bar"
        role="toolbar"
      >
        <button
          aria-expanded={!isCollapsed}
          aria-label={toggleLabel}
          className="flex shrink-0 items-center gap-1 px-1 enabled:hover:bg-secondary"
          data-testid="DevtoolsToolbar--collapse"
          title={`${toggleLabel} (${props.stackName})`}
          type="button"
          onClick={(): void => {
            setIsCollapsed((currentValue: boolean): boolean => !currentValue);
          }}
        >
          <span
            aria-hidden="true"
            className="grid size-4 place-items-center rounded-sm bg-foreground text-[10px] font-bold tracking-tight text-background"
          >
            dh
          </span>
          {isCollapsed ? null : <span>{props.stackName}</span>}
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
    </div>
  );
}
