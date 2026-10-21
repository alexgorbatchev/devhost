import { createRoot } from "react-dom/client";
import { TabCaptureScene } from "../../components/TabCaptureScene";
import { installDevtoolsStyles } from "../../../../src/devtools/shared/devtoolsStyles";
import { registerDevtoolsFonts } from "../../../../src/devtools/shared/registerDevtoolsFonts";

const host = document.getElementById("devhost-devtools-host");
if (!host) throw new Error("The native capture fixture has no devtools host.");
const shadowRoot = host.attachShadow({ mode: "open" });
installDevtoolsStyles(shadowRoot);
registerDevtoolsFonts(document.fonts);
const mount = document.createElement("div");
shadowRoot.append(mount);
const root = createRoot(mount);
root.render(<TabCaptureScene />);
Reflect.set(window, "unmountTabCaptureFixture", () => root.unmount());
