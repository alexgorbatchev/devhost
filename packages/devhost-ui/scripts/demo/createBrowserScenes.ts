import { recordAnnotations } from "./recordAnnotations";
import { recordQuery } from "./recordQuery";
import { recordOverview } from "./recordOverview";
import type { BrowserScene } from "./types";

export function createBrowserScenes(): BrowserScene[] {
  return [
    { id: "overview", caption: "Hover the minimap to see live output from your services.", record: recordOverview },
    {
      id: "annotations",
      caption: "Alt-click. Describe the change. Watch Pi fix the live page.",
      record: recordAnnotations,
    },
    { id: "query", caption: "Native Query devtools are here when you need them.", record: recordQuery },
  ];
}
