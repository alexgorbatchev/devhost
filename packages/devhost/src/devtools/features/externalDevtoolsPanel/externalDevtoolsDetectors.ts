import type { IDetectedExternalDevtoolsLauncher, IExternalDevtoolsDetector } from "./types";

const tanStackRouterDevtoolsDetector: IExternalDevtoolsDetector = {
  detect: detectTanStackRouterDevtools,
  id: "tanstack-router",
  label: "Router",
  title: "Toggle TanStack Router devtools",
};

const tanStackQueryDevtoolsDetector: IExternalDevtoolsDetector = {
  detect: detectTanStackQueryDevtools,
  id: "tanstack-query",
  label: "Query",
  title: "Toggle TanStack Query devtools",
};

export const externalDevtoolsDetectors: readonly IExternalDevtoolsDetector[] = [
  tanStackRouterDevtoolsDetector,
  tanStackQueryDevtoolsDetector,
];

function detectTanStackRouterDevtools(): IDetectedExternalDevtoolsLauncher | null {
  const footerElement: HTMLElement | null = document.querySelector("footer.TanStackRouterDevtools");
  const launcherElement: HTMLElement | null = footerElement?.querySelector("button") ?? null;

  if (launcherElement === null) {
    return null;
  }

  return {
    hiddenElements: [launcherElement],
    launcherElement,
  };
}

function detectTanStackQueryDevtools(): IDetectedExternalDevtoolsLauncher | null {
  const openLauncherElement: HTMLElement | null = document.querySelector(".tsqd-open-btn");
  const minimizeLauncherElement: HTMLElement | null = document.querySelector(".tsqd-minimize-btn");
  const hiddenOpenContainerElement: HTMLElement | null = document.querySelector(".tsqd-open-btn-container");
  const launcherElement: HTMLElement | null = openLauncherElement ?? minimizeLauncherElement;

  if (launcherElement === null) {
    return null;
  }

  return {
    hiddenElements: hiddenOpenContainerElement === null ? [] : [hiddenOpenContainerElement],
    launcherElement,
  };
}
