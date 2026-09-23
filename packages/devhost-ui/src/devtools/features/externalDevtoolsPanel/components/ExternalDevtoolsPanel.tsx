import type { JSX } from "react";

import { Button } from "../../../shared";
import { ToolbarSegment } from "../../../shared/components/ToolbarSegment";
import type { IExternalDevtoolsLauncher } from "../types";

interface IExternalDevtoolsPanelProps {
  launchers: IExternalDevtoolsLauncher[];
  onToggleLauncher: (launcherId: string) => void;
}

/**
 * Toolbar segment that proxies detected third-party devtools launchers as pressed/unpressed toggles; the host
 * library keeps owning its panels.
 */
export function ExternalDevtoolsPanel({
  launchers,
  onToggleLauncher,
}: IExternalDevtoolsPanelProps): JSX.Element | null {
  if (launchers.length === 0) {
    return null;
  }

  return (
    <ToolbarSegment ariaLabel="External devtools" testId="ExternalDevtoolsPanel">
      {launchers.map((launcher: IExternalDevtoolsLauncher) => (
        <Button
          key={launcher.id}
          aria-pressed={launcher.isOpen}
          title={launcher.title}
          onClick={(): void => onToggleLauncher(launcher.id)}
        >
          {launcher.label}
        </Button>
      ))}
    </ToolbarSegment>
  );
}
