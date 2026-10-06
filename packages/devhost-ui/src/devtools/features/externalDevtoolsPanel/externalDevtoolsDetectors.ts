import type { IExternalDevtoolsAdapter } from "./types";
import { tanStackDevtoolsAdapter } from "./tanStackDevtoolsAdapter";

const tanStackRouterDevtoolsAdapter: IExternalDevtoolsAdapter = {
  close: closeTanStackRouterDevtools,
  hideSelectors: ['footer.TanStackRouterDevtools > button:not([data-testid="tanstack_devtools"] *)'],
  id: "tanstack-router",
  isInstalled: isTanStackRouterDevtoolsInstalled,
  isOpen: isTanStackRouterDevtoolsOpen,
  label: "Router",
  open: toggleTanStackRouterDevtools,
  title: "Toggle TanStack Router devtools",
};

const tanStackQueryDevtoolsAdapter: IExternalDevtoolsAdapter = {
  close: closeTanStackQueryDevtools,
  hideSelectors: [
    '.tsqd-open-btn-container:not([data-testid="tanstack_devtools"] *)',
    '.tsqd-open-btn:not([data-testid="tanstack_devtools"] *)',
    '.tsqd-minimize-btn:not([data-testid="tanstack_devtools"] *)',
  ],
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
  tanStackDevtoolsAdapter,
];

function isTanStackRouterDevtoolsInstalled(): boolean {
  return (
    readTanStackRouterDevtoolsToggleButton() !== null || readStandaloneElement(".TanStackRouterDevtoolsPanel") !== null
  );
}

function isTanStackRouterDevtoolsOpen(): boolean {
  const panelElement = readStandaloneElement(".TanStackRouterDevtoolsPanel");

  if (panelElement === null) {
    return false;
  }

  return getComputedStyle(panelElement).display !== "none" && getComputedStyle(panelElement).visibility !== "hidden";
}

function toggleTanStackRouterDevtools(): void {
  readTanStackRouterDevtoolsToggleButton()?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

function closeTanStackRouterDevtools(): void {
  readTanStackRouterDevtoolsCloseButton()?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

function readTanStackRouterDevtoolsToggleButton(): HTMLElement | null {
  return readStandaloneElement("footer.TanStackRouterDevtools > button");
}

function readTanStackRouterDevtoolsCloseButton(): HTMLElement | null {
  return readStandaloneElement(".TanStackRouterDevtoolsPanel > button");
}

function isTanStackQueryDevtoolsInstalled(): boolean {
  return (
    readStandaloneElement(".tsqd-open-btn") !== null ||
    readStandaloneElement(".tsqd-minimize-btn") !== null ||
    readStandaloneElement(".tsqd-main-panel") !== null
  );
}

function isTanStackQueryDevtoolsOpen(): boolean {
  return readStandaloneElement(".tsqd-main-panel") !== null;
}

function openTanStackQueryDevtools(): void {
  readTanStackQueryOpenButton()?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

function closeTanStackQueryDevtools(): void {
  readTanStackQueryCloseButton()?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

function readTanStackQueryOpenButton(): HTMLElement | null {
  const openButton = readStandaloneElement(".tsqd-open-btn");

  if (openButton !== null) {
    return openButton;
  }

  return readStandaloneElement('.tsqd-main-panel button[aria-label="Open Tanstack query devtools"]');
}

function readTanStackQueryCloseButton(): HTMLElement | null {
  return readStandaloneElement(
    '.tsqd-minimize-btn, .tsqd-main-panel button[aria-label="Close tanstack query devtools"]',
  );
}

function readStandaloneElement(selector: string): HTMLElement | null {
  return (
    [...document.querySelectorAll<HTMLElement>(selector)].find(
      (element) => element.closest('[data-testid="tanstack_devtools"]') === null,
    ) ?? null
  );
}
