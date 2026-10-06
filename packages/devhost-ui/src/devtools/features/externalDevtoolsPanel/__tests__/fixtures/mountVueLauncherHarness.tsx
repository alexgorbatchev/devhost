import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { installDevtoolsStyles } from "../../../../shared/devtoolsStyles";
import { VueLauncherHarness } from "./components/VueLauncherHarness";

export function mountVueLauncherHarness(): void {
  const mount = document.querySelector("#devhost-fixture");
  if (mount === null) return;
  const shadow = mount.attachShadow({ mode: "open" });
  installDevtoolsStyles(shadow);
  const container = document.createElement("div");
  container.setAttribute("data-devhost-devtools", "");
  shadow.append(container);
  let root = createRoot(container);
  const render = (): void => {
    root.render(
      <StrictMode>
        <VueLauncherHarness />
      </StrictMode>,
    );
  };
  document.querySelector("#unmount-devhost")?.addEventListener("click", () => root.unmount());
  document.querySelector("#mount-devhost")?.addEventListener("click", () => {
    root = createRoot(container);
    render();
  });
  render();
}

mountVueLauncherHarness();
