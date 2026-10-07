import { mock } from "bun:test";

import type {
  DispatchEventFn,
  IJotaiInspectorFixture,
  INativeVueHostOptions,
  ITanStackShellFixture,
  JotaiInspectorAction,
} from "../helpers";

export const fixture_visibilityModes: readonly INativeVueHostOptions[] = [
  { visibility: "hidden" },
  { visibility: "passive" },
];

/** A Jotai DevTools root: a launcher while closed, a shell while open. Non-native roots contain neither. */
export function factory_jotaiInspector(isNative: boolean = true): IJotaiInspectorFixture {
  let isOpen = false;
  const open = mock<JotaiInspectorAction>(() => {
    isOpen = true;
  });
  const close = mock<JotaiInspectorAction>(() => {
    isOpen = false;
  });
  let launcher = { click: open };
  const shell = {
    querySelector: () => ({ click: close }),
    querySelectorAll: () => [{ textContent: "Atom Viewer" }, { textContent: "Time travel" }],
  };
  const root = {
    querySelector: (selector: string) => {
      if (!isNative) return null;
      if (selector.startsWith("button.internal-jotai-devtools-trigger-button")) return isOpen ? null : launcher;
      if (selector === ".internal-jotai-devtools-shell.jotai-devtools-shell") return isOpen ? shell : null;
      return null;
    },
  } as unknown as HTMLElement;

  return {
    root,
    open,
    close,
    replaceLauncher: () => {
      const replacement = mock<JotaiInspectorAction>(() => {
        isOpen = true;
      });
      launcher = { click: replacement };
      return replacement;
    },
  };
}

/** A TanStack Devtools shell root with an optional trigger and panel. */
export function factory_tanStackShell(
  isOpen: boolean,
  hasTrigger: boolean = true,
  hasPanel: boolean = true,
): ITanStackShellFixture {
  const panel = { getAttribute: () => String(isOpen) };
  const openButton = mock<DispatchEventFn>(() => {
    isOpen = true;
    return true;
  });
  const closeButton = mock<DispatchEventFn>(() => {
    isOpen = false;
    return true;
  });
  const elementsBySelector = new Map<string, unknown>([
    [
      'button[data-tsd-control][aria-label^="Open TanStack Devtools"]',
      hasTrigger ? { dispatchEvent: openButton } : null,
    ],
    ['button[data-testid="tsd-close-button"]', { dispatchEvent: closeButton }],
    ['[data-testid="tanstack-devtools-panel"]', hasPanel ? panel : null],
  ]);

  return {
    root: { querySelector: (selector: string) => elementsBySelector.get(selector) ?? null } as unknown as HTMLElement,
    openButton,
    closeButton,
  };
}
