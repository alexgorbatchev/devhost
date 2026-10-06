import type { JSX } from "react";
import type { INativeReactFixtureControls } from "../types";

export function NativeReactFixtureControls(controls: INativeReactFixtureControls): JSX.Element {
  return (
    <nav aria-label="Native fixture lifecycle" data-testid="NativeReactFixtureControls">
      <button type="button" onClick={(): void => controls.setExternalToolbarsEnabled(false)}>
        Disable external tools
      </button>
      <button type="button" onClick={(): void => controls.setExternalToolbarsEnabled(true)}>
        Enable external tools
      </button>
      <button type="button" onClick={controls.unmountDevhost}>
        Unmount actual App root
      </button>
      <button type="button" onClick={controls.mountDevhost}>
        Mount actual App root
      </button>
      <button type="button" onClick={controls.unmountHost}>
        Unmount host root
      </button>
      <button type="button" onClick={controls.mountHost}>
        Mount host root
      </button>
    </nav>
  );
}
