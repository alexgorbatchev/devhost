import type { IExternalDevtoolsAdapter } from "./types";

const tanStackRouterDevtoolsAdapter: IExternalDevtoolsAdapter = {
  close: toggleTanStackRouterDevtools,
  hideSelectors: ["footer.TanStackRouterDevtools > button"],
  id: "tanstack-router",
  isInstalled: isTanStackRouterDevtoolsInstalled,
  isOpen: isTanStackRouterDevtoolsOpen,
  label: "Router",
  open: toggleTanStackRouterDevtools,
  title: "Toggle TanStack Router devtools",
};

const tanStackQueryDevtoolsAdapter: IExternalDevtoolsAdapter = {
  close: closeTanStackQueryDevtools,
  hideSelectors: [".tsqd-open-btn-container", ".tsqd-open-btn", ".tsqd-minimize-btn"],
  id: "tanstack-query",
  isInstalled: isTanStackQueryDevtoolsInstalled,
  isOpen: isTanStackQueryDevtoolsOpen,
  label: "Query",
  open: openTanStackQueryDevtools,
  title: "Toggle TanStack Query devtools",
};

export const externalDevtoolsDetectors: readonly IExternalDevtoolsAdapter[] = [
  tanStackRouterDevtoolsAdapter,
  tanStackQueryDevtoolsAdapter,
];

function isTanStackRouterDevtoolsInstalled(): boolean {
  return (
    readTanStackRouterDevtoolsToggleButton() !== null || document.querySelector(".TanStackRouterDevtoolsPanel") !== null
  );
}

function isTanStackRouterDevtoolsOpen(): boolean {
  const panelElement: HTMLElement | null = document.querySelector(".TanStackRouterDevtoolsPanel");

  if (panelElement === null) {
    return false;
  }

  return getComputedStyle(panelElement).display !== "none" && getComputedStyle(panelElement).visibility !== "hidden";
}

function toggleTanStackRouterDevtools(): void {
  readTanStackRouterDevtoolsToggleButton()?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

function readTanStackRouterDevtoolsToggleButton(): HTMLElement | null {
  return document.querySelector("footer.TanStackRouterDevtools > button");
}

function isTanStackQueryDevtoolsInstalled(): boolean {
  return (
    document.querySelector(".tsqd-open-btn") !== null ||
    document.querySelector(".tsqd-minimize-btn") !== null ||
    document.querySelector(".tsqd-main-panel") !== null
  );
}

function isTanStackQueryDevtoolsOpen(): boolean {
  return document.querySelector(".tsqd-main-panel") !== null;
}

function openTanStackQueryDevtools(): void {
  readTanStackQueryOpenButton()?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

function closeTanStackQueryDevtools(): void {
  readTanStackQueryCloseButton()?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

function readTanStackQueryOpenButton(): HTMLElement | null {
  const openButton = document.querySelector<HTMLElement>(".tsqd-open-btn");

  if (openButton !== null) {
    return openButton;
  }

  return document.querySelector<HTMLElement>('.tsqd-main-panel button[aria-label="Open Tanstack query devtools"]');
}

function readTanStackQueryCloseButton(): HTMLElement | null {
  return document.querySelector(
    '.tsqd-minimize-btn, .tsqd-main-panel button[aria-label="Close tanstack query devtools"]',
  );
}
