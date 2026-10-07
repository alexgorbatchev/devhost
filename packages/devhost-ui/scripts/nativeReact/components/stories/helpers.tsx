import { createRoot, type Root } from "react-dom/client";
import { App } from "../../../../src/devtools/components/App";
import { DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME } from "../../../../src/devtools/shared/constants";
import { readInjectedDevtoolsConfig } from "../../../../src/devtools/shared/readInjectedDevtoolsConfig";
import { renderDevtoolsInStoryShadowRoot } from "../../../../src/devtools/shared/components/stories/helpers";
import { HostApp } from "../HostApp";
import type { INativeReactFixtureControls, NativeReactDispose } from "../../types";

let activeControls: INativeReactFixtureControls | null = null;

/** Storybook beforeEach owns real Roots outside an ancestor React commit. */
export function mountNativeReactStoryRoots(): NativeReactDispose {
  const original: unknown = Reflect.get(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME);
  const configuration = {
    ...readInjectedDevtoolsConfig(),
    editorEnabled: false,
    statusEnabled: false,
    terminalEnabled: false,
    minimapEnabled: false,
    annotationEnabled: false,
    annotationQueueEnabled: false,
    nativeBrowserConfigured: false,
    externalToolbarsEnabled: true,
  };
  Reflect.set(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME, configuration);
  const owner = document.createElement("section");
  owner.setAttribute("aria-label", "Native React story roots");
  const host = document.createElement("div");
  const devhost = document.createElement("div");
  devhost.dataset.testid = "Actual App root container";
  owner.append(host, devhost);
  document.body.append(owner);
  let hostRoot: Root | null = null;
  let devhostRoot: Root | null = null;
  const mountHost = (): void => {
    if (hostRoot !== null) return;
    hostRoot = createRoot(host);
    hostRoot.render(<HostApp projectName="Controls" />);
  };
  const mountDevhost = (): void => {
    if (devhostRoot !== null) return;
    devhostRoot = createRoot(devhost);
    devhostRoot.render(renderDevtoolsInStoryShadowRoot(<App />));
  };
  const unmountHost = (): void => {
    hostRoot?.unmount();
    hostRoot = null;
  };
  const unmountDevhost = (): void => {
    devhostRoot?.unmount();
    devhostRoot = null;
  };
  activeControls = {
    mountHost,
    unmountHost,
    mountDevhost,
    unmountDevhost,
    setExternalToolbarsEnabled: (isEnabled): void => {
      configuration.externalToolbarsEnabled = isEnabled;
      devhostRoot?.render(renderDevtoolsInStoryShadowRoot(<App />));
    },
  };
  mountHost();
  mountDevhost();
  return (): void => {
    unmountHost();
    unmountDevhost();
    owner.remove();
    activeControls = null;
    Reflect.set(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME, original);
  };
}

export function readNativeReactStoryControls(): INativeReactFixtureControls {
  if (activeControls === null) throw new Error("The story lifecycle did not mount native fixture Roots.");
  return activeControls;
}
