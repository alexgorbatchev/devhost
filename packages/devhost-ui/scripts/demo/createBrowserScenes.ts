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
      caption: "Select page context. Share the current tab. Chat with your configured agent.",
      record: recordAnnotations,
    },
    { id: "query", caption: "Native Query devtools are here when you need them.", record: recordQuery },
    {
      id: "react-highlight",
      caption: "Connect source locators to your live page through the native API.",
      record: recordReactHighlight,
    },
  ];
}
