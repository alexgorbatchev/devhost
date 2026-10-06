import type { IExternalDevtoolsAdapter } from "./types";

const rootSelector = '[data-testid="tanstack_devtools"]';
const panelSelector = '[data-testid="tanstack-devtools-panel"]';
const openSelector = 'button[data-tsd-control][aria-label^="Open TanStack Devtools"]';
const closeSelector = 'button[data-testid="tsd-close-button"]';

export const tanStackDevtoolsAdapter: IExternalDevtoolsAdapter = {
  id: "tanstack-devtools",
  label: "TanStack",
  title: "Toggle TanStack Devtools",
  hideSelectors: [`${rootSelector} ${openSelector}`, `${rootSelector} ${closeSelector}`],
  isInstalled: () => readShellRoots().length > 0,
  isOpen: () => readShellRoots().some(isShellOpen),
  open: () => {
    readShellRoots()
      .find((root) => !isShellOpen(root))
      ?.querySelector(openSelector)
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  },
  close: () => {
    readShellRoots()
      .find(isShellOpen)
      ?.querySelector(closeSelector)
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  },
};

// Native shells share the window event bus. One control toggles the attached shells together.
// Re-query each time: URL gating, PiP, host unmounts and HMR can replace or remove their roots.
function readShellRoots(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(rootSelector)].filter(
    (root) => root.querySelector(panelSelector) !== null && root.querySelector(openSelector) !== null,
  );
}

function isShellOpen(root: HTMLElement): boolean {
  return root.querySelector(panelSelector)?.getAttribute("data-open") === "true";
}
