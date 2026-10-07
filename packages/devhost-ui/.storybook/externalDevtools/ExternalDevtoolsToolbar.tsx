import type { JSX } from "react";

import { ExternalDevtoolsPanel } from "@/devtools/features/externalDevtoolsPanel/components/ExternalDevtoolsPanel";
import { useExternalDevtoolsLaunchers } from "@/devtools/features/externalDevtoolsPanel/hooks/useExternalDevtoolsLaunchers";
import { DevtoolsToolbar } from "@/devtools/shared/components/DevtoolsToolbar";
import { StorybookThemeProvider } from "@/devtools/shared/components/stories/helpers";

interface IExternalDevtoolsToolbarProps {
  globals: Partial<Record<string, unknown>>;
  isEnabled: boolean;
  stackName: string;
}

/** The devtools toolbar with a launcher for each third-party devtools the story's host page has mounted. */
export function ExternalDevtoolsToolbar({ globals, isEnabled, stackName }: IExternalDevtoolsToolbarProps): JSX.Element {
  const { launchers, toggleLauncher } = useExternalDevtoolsLaunchers(isEnabled);

  return (
    <StorybookThemeProvider globals={globals}>
      <DevtoolsToolbar collapsedIndicator={null} isMinimapVisible={false} position="bottom-right" stackName={stackName}>
        <ExternalDevtoolsPanel launchers={launchers} onToggleLauncher={toggleLauncher} />
      </DevtoolsToolbar>
    </StorybookThemeProvider>
  );
}
