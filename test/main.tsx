import { createRoot } from "react-dom/client";

import { App } from "./App";

const rootElement: HTMLElement | null = document.getElementById("root");

if (rootElement === null) {
  throw new Error("Missing #root element in test/index.html");
}

const root = createRoot(rootElement);

root.render(<App initialRecordingUrl="/recording.json" isDevelopmentMode />);
