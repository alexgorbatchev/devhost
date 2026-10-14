import type { JSX, ReactNode } from "react";

interface IPanelActionsProps {
  children: ReactNode;
}

/** A row of panel-level actions, aligned to the end of the panel. */
export function PanelActions({ children }: IPanelActionsProps): JSX.Element {
  return (
    <div className="flex items-center justify-end gap-1.5 px-2 py-1" data-testid="PanelActions">
      {children}
    </div>
  );
}
