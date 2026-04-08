import { createRoot } from "react-dom/client";

import { App } from "./App";

export function Main(): React.JSX.Element {
  return <App initialRecordingUrl="/recording.json" isDevelopmentMode />;
}

const rootElement: HTMLElement | null = document.getElementById("root");

if (rootElement !== null) {
  console.log("Rendering devhost test app!", rootElement);
  createRoot(rootElement).render(<Main />);
} else {
  console.error("Root element not found!");
}
