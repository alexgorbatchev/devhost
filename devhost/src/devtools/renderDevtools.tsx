import { render } from "preact";

import { DEVTOOLS_ROOT_ID } from "./constants";
import { DevtoolsApp } from "./DevtoolsApp";

export function renderDevtools(): void {
  if (document.getElementById(DEVTOOLS_ROOT_ID) !== null) {
    return;
  }

  const mountApplication = (): void => {
    if (document.body === null || document.getElementById(DEVTOOLS_ROOT_ID) !== null) {
      return;
    }

    const mountNode: HTMLDivElement = document.createElement("div");
    document.body.append(mountNode);
    render(<DevtoolsApp />, mountNode);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountApplication, { once: true });
    return;
  }

  mountApplication();
}
