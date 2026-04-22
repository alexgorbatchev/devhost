import { jsx } from "react/jsx-runtime";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { DEVTOOLS_HOST_ID, configureDevtoolsCss, injectGlobal } from "./shared";
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
    shadowRoot.append(mountNode);
    document.body.append(hostNode);

    configureDevtoolsCss(shadowRoot);
    injectGlobal({
      ":host": {
        color: "initial",
      },
      "*, *::before, *::after": {
        boxSizing: "border-box",
      },
      button: {
        font: "inherit",
      },
      input: {
        font: "inherit",
      },
      textarea: {
        font: "inherit",
      },
    });
    createRoot(mountNode).render(jsx(App, {}));
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountApplication, { once: true });
    return;
  }

  mountApplication();
}
