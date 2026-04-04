import { createRoot } from "react-dom/client";

import { App } from "./App";

export function Main(): React.JSX.Element {
  return <App initialRecordingUrl="/recording.json" isDevelopmentMode />;
}

const rootElement: HTMLElement | null = document.getElementById("root");

if (rootElement !== null) {
  createRoot(rootElement).render(<Main />);
}
