import { recordAnnotations } from "./recordAnnotations";
import { recordQuery } from "./recordQuery";
import { recordOverview } from "./recordOverview";
import { recordReactHighlight } from "./recordReactHighlight";
import type { IBrowserScene } from "./types";

export function createBrowserScenes(): IBrowserScene[] {
  return [
    { id: "overview", caption: "Hover the minimap to see live output from your services.", record: recordOverview },
    {
      id: "annotations",
      caption: "Alt-click. Describe the change. Watch Pi fix the live page.",
      record: recordAnnotations,
    },
    { id: "query", caption: "Native Query devtools are here when you need them.", record: recordQuery },
    {
      id: "react-highlight",
      caption: "Connect the JSX cursor in Neovim to your live page.",
      record: recordReactHighlight,
    },
  ];
}
