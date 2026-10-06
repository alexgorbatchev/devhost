import { jsx } from "react/jsx-runtime";
import { createRoot, type Root } from "react-dom/client";

import { App } from "./components/App";
import { DEVTOOLS_HOST_ID, installDevtoolsStyles } from "./shared";
import { DEVTOOLS_ROOT_ATTRIBUTE_NAME } from "./shared/constants";
import { registerDevtoolsFonts } from "./shared/registerDevtoolsFonts";

export type UnmountDevtools = () => void;

/**
 * Mounts the devtools once per document, as soon as the document has a body. The returned function unmounts the
 * devtools this call mounted and removes their host; it does nothing when another call already owned the mount.
 */
export function renderDevtools(): UnmountDevtools {
  let unmountApplication: UnmountDevtools | null = null;

  const mountApplication = (): void => {
    if (document.body === null || document.getElementById(DEVTOOLS_HOST_ID) !== null) {
      return;
    }

    const hostNode: HTMLDivElement = document.createElement("div");
    const shadowRoot: ShadowRoot = hostNode.attachShadow({ mode: "open" });
    const mountNode: HTMLDivElement = document.createElement("div");
    const root: Root = createRoot(mountNode);

    hostNode.id = DEVTOOLS_HOST_ID;
    hostNode.setAttribute(DEVTOOLS_ROOT_ATTRIBUTE_NAME, "");
    hostNode.setAttribute("data-theme", "dark");
    shadowRoot.append(mountNode);
    document.body.append(hostNode);

    installDevtoolsStyles(shadowRoot);
    registerDevtoolsFonts(document.fonts);
    root.render(jsx(App, {}));
    unmountApplication = (): void => {
      root.unmount();
      hostNode.remove();
    };
  };
  const unmount: UnmountDevtools = (): void => {
    document.removeEventListener("DOMContentLoaded", mountApplication);
    unmountApplication?.();
    unmountApplication = null;
  };

  if (document.getElementById(DEVTOOLS_HOST_ID) !== null) {
    return unmount;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountApplication, { once: true });
    return unmount;
  }

  mountApplication();

  return unmount;
}
