import type {
  CountClick,
  IJotaiInspectorFixture,
  INativeVueHostOptions,
  ITanStackShellFixture,
  ReadClickCount,
} from "../helpers";

export const fixture_visibilityModes: readonly INativeVueHostOptions[] = [
  { visibility: "hidden" },
  { visibility: "passive" },
];

/**
 * A Jotai DevTools root built from real elements, with the markup the native 0.14.0 inspector renders: a launcher
 * while closed, and a shell with its minimize button and tabs while open. Clicking the launcher opens it and
 * clicking the minimize button closes it. A root that is not native carries the root id and nothing the inspector
 * renders. The caller adds `root` to the page.
 */
export function factory_jotaiInspector(isNative: boolean = true): IJotaiInspectorFixture {
  const root: HTMLDivElement = document.createElement("div");
  let openCount: number = 0;
  let closeCount: number = 0;

  const showShell = (): void => {
    const shell: HTMLDivElement = document.createElement("div");
    const minimizeButton: HTMLButtonElement = document.createElement("button");

    shell.className = "internal-jotai-devtools-shell jotai-devtools-shell";
    minimizeButton.title = "Minimize panel";
    minimizeButton.addEventListener("click", (): void => {
      closeCount += 1;
      showLauncher((): void => {
        openCount += 1;
      });
    });
    shell.append(
      minimizeButton,
      ...["Atom Viewer", "Time travel"].map((label: string): HTMLDivElement => {
        const tab: HTMLDivElement = document.createElement("div");

        tab.setAttribute("role", "tab");
        tab.textContent = label;

        return tab;
      }),
    );
    root.replaceChildren(shell);
  };
  const showLauncher = (countClick: CountClick): void => {
    const launcher: HTMLButtonElement = document.createElement("button");
    const mascot: HTMLImageElement = document.createElement("img");

    launcher.className = "internal-jotai-devtools-trigger-button jotai-devtools-trigger-button";
    launcher.title = "Open Jotai Devtools";
    mascot.alt = "Jotai Mascot";
    launcher.append(mascot);
    launcher.addEventListener("click", (): void => {
      countClick();
      showShell();
    });
    root.replaceChildren(launcher);
  };

  root.id = "jotai-devtools-root";
  if (isNative) {
    showLauncher((): void => {
      openCount += 1;
    });
  }

  return {
    root,
    readOpenCount: (): number => openCount,
    readCloseCount: (): number => closeCount,
    replaceLauncher: (): ReadClickCount => {
      let replacementOpenCount: number = 0;

      showLauncher((): void => {
        replacementOpenCount += 1;
      });

      return (): number => replacementOpenCount;
    },
  };
}

/**
 * A TanStack Devtools shell root built from real elements: its panel, whose `data-open` the native shell keeps up
 * to date, its opening control, and its close button. Clicking the opening control opens the panel and clicking the
 * close button closes it. The caller adds `root` to the page.
 */
export function factory_tanStackShell(
  isOpen: boolean,
  hasTrigger: boolean = true,
  hasPanel: boolean = true,
): ITanStackShellFixture {
  const root: HTMLDivElement = document.createElement("div");
  const panel: HTMLDivElement = document.createElement("div");
  const openButton: HTMLButtonElement = document.createElement("button");
  const closeButton: HTMLButtonElement = document.createElement("button");
  let openCount: number = 0;
  let closeCount: number = 0;

  root.setAttribute("data-testid", "tanstack_devtools");
  panel.setAttribute("data-testid", "tanstack-devtools-panel");
  panel.setAttribute("data-open", String(isOpen));
  openButton.setAttribute("data-tsd-control", "");
  openButton.setAttribute("aria-label", "Open TanStack Devtools");
  openButton.addEventListener("click", (): void => {
    openCount += 1;
    panel.setAttribute("data-open", "true");
  });
  closeButton.setAttribute("data-testid", "tsd-close-button");
  closeButton.addEventListener("click", (): void => {
    closeCount += 1;
    panel.setAttribute("data-open", "false");
  });
  root.append(closeButton);
  if (hasTrigger) {
    root.append(openButton);
  }
  if (hasPanel) {
    root.append(panel);
  }

  return {
    root,
    readOpenCount: (): number => openCount,
    readCloseCount: (): number => closeCount,
  };
}
