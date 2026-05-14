import type { JSX } from "react";

import { Button, HoverSlidePanel } from "../../../shared";
import type { IExternalDevtoolsLauncher } from "../types";

interface IExternalDevtoolsPanelProps {
  launchers: IExternalDevtoolsLauncher[];
  onToggleLauncher: (launcherId: string) => void;
}

export function ExternalDevtoolsPanel({
  launchers,
  onToggleLauncher,
}: IExternalDevtoolsPanelProps): JSX.Element | null {
  if (launchers.length === 0) {
    return null;
  }

  const hasOpenLauncher: boolean = launchers.some((launcher) => launcher.isOpen);

  return (
    <HoverSlidePanel
      ariaLabel="external devtools"
      isPinned={hasOpenLauncher}
      testId="ExternalDevtoolsPanel"
      title="Tools"
    >
      <div className="flex flex-row flex-wrap justify-start gap-1" data-testid="ExternalDevtoolsPanel--launcher-list">
        {launchers.map((launcher) => (
          <Button
            key={launcher.id}
            ariaPressed={launcher.isOpen}
            title={launcher.title}
            variant={launcher.isOpen ? "primary" : "secondary"}
            onClick={(): void => onToggleLauncher(launcher.id)}
          >
            {launcher.label}
          </Button>
        ))}
      </div>
    </HoverSlidePanel>
  );
}
