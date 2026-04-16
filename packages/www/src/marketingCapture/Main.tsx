import { type JSX } from "react";
import { createRoot } from "react-dom/client";

import "../app/App.css";
import { MarketingCapturePage } from "./MarketingCapturePage";

export function Main(): JSX.Element {
  return <MarketingCapturePage />;
}

const rootElement: HTMLElement | null = document.getElementById("root");

if (rootElement !== null) {
  createRoot(rootElement).render(<Main />);
}
