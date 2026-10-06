import type { JSX } from "react";
import { useState } from "react";

import { ExternalDevtoolsPanel } from "../../../components/ExternalDevtoolsPanel";
import { useExternalDevtoolsLaunchers } from "../../../hooks/useExternalDevtoolsLaunchers";
import { DevtoolsToolbar } from "../../../../../shared/components/DevtoolsToolbar";

export function VueLauncherHarness(): JSX.Element {
  const [isEnabled, setIsEnabled] = useState(
    () => new URL(location.href).searchParams.get("aggregation") !== "disabled",
  );
  const { launchers, toggleLauncher } = useExternalDevtoolsLaunchers(isEnabled);
  return (
    <DevtoolsToolbar collapsedIndicator={null} isMinimapVisible={false} position="bottom-right" stackName="Vue fixture">
      <button onClick={() => setIsEnabled((current) => !current)}>Toggle aggregation</button>
      <ExternalDevtoolsPanel launchers={launchers} onToggleLauncher={toggleLauncher} />
    </DevtoolsToolbar>
  );
}
