import { jsx } from "react/jsx-runtime";
import { createRoot } from "react-dom/client";

import { App } from "./components/App";
import { DEVTOOLS_HOST_ID, installDevtoolsStyles } from "./shared";
import { DEVTOOLS_ROOT_ATTRIBUTE_NAME } from "./shared/constants";

export function renderDevtools(): void {
  if (document.getElementById(DEVTOOLS_HOST_ID) !== null) {
    return;
  }

  const mountApplication = (): void => {
    if (document.body === null || document.getElementById(DEVTOOLS_HOST_ID) !== null) {
      return;
    }

    const hostNode: HTMLDivElement = document.createElement("div");
    const shadowRoot: ShadowRoot = hostNode.attachShadow({ mode: "open" });
    const mountNode: HTMLDivElement = document.createElement("div");

    hostNode.id = DEVTOOLS_HOST_ID;
    hostNode.setAttribute(DEVTOOLS_ROOT_ATTRIBUTE_NAME, "");
    hostNode.setAttribute("data-theme", "dark");
    shadowRoot.append(mountNode);
    document.body.append(hostNode);

    installDevtoolsStyles(shadowRoot);
    createRoot(mountNode).render(jsx(App, {}));
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountApplication, { once: true });
    return;
  }

  mountApplication();
}
