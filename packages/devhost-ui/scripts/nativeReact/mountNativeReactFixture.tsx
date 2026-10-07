import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { App } from "../../src/devtools/components/App";
import { DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME, DEVTOOLS_HOST_ID } from "../../src/devtools/shared/constants";
import { activatePristineFetch, pristineFetch } from "../../src/devtools/shared/pristineFetch";
import { installDevtoolsStyles } from "../../src/devtools/shared/devtoolsStyles";
import { registerDevtoolsFonts } from "../../src/devtools/shared/registerDevtoolsFonts";
import { HostApp } from "./components/HostApp";
import { NativeReactFixtureControls } from "./components/NativeReactFixtureControls";
import type { INativeReactFixtureControls } from "./types";

export async function mountNativeReactFixture(): Promise<void> {
  const url = new URL(location.href);
  const projectName: string = url.searchParams.get("project") ?? "A";
  const hostContainer = document.getElementById("host-root");
  if (hostContainer === null) throw new Error("Native React host container is missing.");
  let hostRoot: Root | null = null;
  const mountHost = (): void => {
    if (hostRoot !== null) return;
    hostRoot = createRoot(hostContainer);
    hostRoot.render(<HostApp projectName={projectName} />);
  };
  if (url.searchParams.get("host") !== "none") mountHost();
  if (url.searchParams.get("owner") !== "fixture") return;
  // This container exists in the initial HTML. The unchanged shipped entry
  // consequently does not create a second App; this fixture owns a real Root.
  const devhostContainer = document.getElementById(DEVTOOLS_HOST_ID);
  if (devhostContainer === null) throw new Error("Actual App fixture container is missing.");
  const shadowRoot = devhostContainer.attachShadow({ mode: "open" });
  const mountContainer = document.createElement("div");
  shadowRoot.append(mountContainer);
  installDevtoolsStyles(shadowRoot);
  registerDevtoolsFonts(document.fonts);
  activatePristineFetch();
  const response = await pristineFetch("/__devhost__/config.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`Native fixture configuration failed: ${response.status}`);
  const configuration: unknown = await response.json();
  if (typeof configuration !== "object" || configuration === null) throw new Error("Invalid actual Go configuration.");
  Reflect.set(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME, configuration);
  let devhostRoot: Root | null = null;
  const mountDevhost = (): void => {
    if (devhostRoot !== null) return;
    devhostRoot = createRoot(mountContainer);
    devhostRoot.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  };
  const controls: INativeReactFixtureControls = {
    mountDevhost,
    unmountDevhost: (): void => {
      devhostRoot?.unmount();
      devhostRoot = null;
    },
    setExternalToolbarsEnabled: (isEnabled): void => {
      const activeConfiguration: unknown = Reflect.get(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME);
      if (typeof activeConfiguration !== "object" || activeConfiguration === null)
        throw new Error("Actual App configuration is missing.");
      const wasEnabled: unknown = Reflect.get(activeConfiguration, "externalToolbarsEnabled");
      Reflect.set(activeConfiguration, "externalToolbarsEnabled", isEnabled);
      console.info(
        "Native fixture external toolbar configuration",
        JSON.stringify({
          isInitialConfigurationActive: activeConfiguration === configuration,
          wasEnabled,
          isEnabled: Reflect.get(activeConfiguration, "externalToolbarsEnabled"),
        }),
      );
      devhostRoot?.render(
        <StrictMode>
          <App />
        </StrictMode>,
      );
    },
    mountHost,
    unmountHost: (): void => {
      hostRoot?.unmount();
      hostRoot = null;
    },
  };
  const controlsContainer = document.getElementById("fixture-controls");
  if (controlsContainer === null) throw new Error("Native fixture controls container is missing.");
  createRoot(controlsContainer).render(<NativeReactFixtureControls {...controls} />);
  mountDevhost();
}

void mountNativeReactFixture();
