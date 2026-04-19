import { type JSX } from "react";
import { createRoot } from "react-dom/client";

import "../../app/App.css";
import { MarketingCapturePage } from "./MarketingCapturePage";

export function Main(): JSX.Element {
  return <MarketingCapturePage />;
}

const rootElement: HTMLElement | null = document.getElementById("root");

if (rootElement !== null) {
  void renderCapturePage(rootElement);
}

async function renderCapturePage(rootElement: HTMLElement): Promise<void> {
  const captureProjectRootPath: string = await readCaptureProjectRootPath();

  window.__DEVHOST_CAPTURE_PROJECT_ROOT__ = captureProjectRootPath;
  createRoot(rootElement).render(<Main />);
}

async function readCaptureProjectRootPath(): Promise<string> {
  const response: Response = await fetch("/__capture__/project-root", { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Failed to load capture project root: ${response.status}`);
  }

  return await response.text();
}
