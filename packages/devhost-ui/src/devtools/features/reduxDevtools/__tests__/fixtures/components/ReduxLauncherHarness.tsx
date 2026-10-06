import { useState } from "react";
import type { JSX } from "react";
import { ExternalDevtoolsPanel } from "../../../../externalDevtoolsPanel/components/ExternalDevtoolsPanel";
import { useExternalDevtoolsLaunchers } from "../../../../externalDevtoolsPanel/hooks/useExternalDevtoolsLaunchers";
import { DevtoolsToolbar } from "../../../../../shared/components/DevtoolsToolbar";

export function ReduxLauncherHarness(): JSX.Element {
  const [isEnabled, setIsEnabled] = useState(
    () => new URL(location.href).searchParams.get("aggregation") !== "disabled",
  );
  const { launchers, toggleLauncher } = useExternalDevtoolsLaunchers(isEnabled);
  return (
    <DevtoolsToolbar
      collapsedIndicator={null}
      isMinimapVisible={false}
      position="bottom-right"
      stackName="Redux fixture"
    >
      <button onClick={() => setIsEnabled((current) => !current)}>Toggle aggregation</button>
      <ExternalDevtoolsPanel launchers={launchers} onToggleLauncher={toggleLauncher} />
    </DevtoolsToolbar>
  );
}
