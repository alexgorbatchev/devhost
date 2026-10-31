import type { JSX } from "react";
import { Button } from "../../../shared";
import { ToolbarSegment } from "../../../shared/components/ToolbarSegment";

interface IReloadHoldToggleProps {
  isEnabled: boolean;
  onToggle: VoidFunction;
}

export function ReloadHoldToggle({ isEnabled, onToggle }: IReloadHoldToggleProps): JSX.Element {
  return (
    <ToolbarSegment ariaLabel="Reload hold" testId="ReloadHoldToggle">
      <Button
        aria-pressed={isEnabled}
        title="Stops scripts, such as a dev server, from reloading this page"
        onClick={onToggle}
      >
        Hold Reloads
      </Button>
    </ToolbarSegment>
  );
}
