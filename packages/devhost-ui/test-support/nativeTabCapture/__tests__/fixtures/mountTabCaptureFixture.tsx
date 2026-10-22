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
// The acceptance run chooses the chat target through the page URL: `?target=devhost` annotates devhost UI.
const target = new URLSearchParams(location.search).get("target") === "devhost" ? "devhost" : "project";
root.render(<TabCaptureScene target={target} />);
Reflect.set(window, "unmountTabCaptureFixture", () => root.unmount());
