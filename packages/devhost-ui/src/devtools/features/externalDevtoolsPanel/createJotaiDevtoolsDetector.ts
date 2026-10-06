import type { IExternalDevtoolsAdapter } from "./types";

const rootSelector: string = '[id="jotai-devtools-root"]';
const launcherSelector: string =
  'button.internal-jotai-devtools-trigger-button.jotai-devtools-trigger-button[title="Open Jotai Devtools"]:has(img[alt="Jotai Mascot"])';
const shellSelector: string = ".internal-jotai-devtools-shell.jotai-devtools-shell";
const closeSelector: string = 'button[title="Minimize panel"]';

type ReadAdapters = () => IExternalDevtoolsAdapter[];

/** Native 0.14.0 roots persist while their launcher and panel replace one another. */
export function createJotaiDevtoolsDetector(hostDocument: Document): ReadAdapters {
  const identities = new WeakMap<HTMLElement, number>();
  let nextIdentity = 1;

  function readShell(root: HTMLElement): HTMLElement | null {
    const shell = root.querySelector<HTMLElement>(shellSelector);
    if (shell === null || shell.querySelector(closeSelector) === null) return null;
    const tabs = Array.from(shell.querySelectorAll('[role="tab"]')).map((tab) => tab.textContent?.trim());
    return tabs.includes("Atom Viewer") && tabs.includes("Time travel") ? shell : null;
  }

  function readRoots(): HTMLElement[] {
    return Array.from(hostDocument.querySelectorAll<HTMLElement>(rootSelector)).filter(
      (root) => root.querySelector(launcherSelector) !== null || readShell(root) !== null,
    );
  }

  function readRoot(identity: number): HTMLElement | undefined {
    return readRoots().find((root) => identities.get(root) === identity);
  }

  return (): IExternalDevtoolsAdapter[] =>
    readRoots().map((root) => {
      const identity = identities.get(root) ?? nextIdentity++;
      identities.set(root, identity);
      return {
        id: `jotai-${identity}`,
        label: `Jotai ${identity}`,
        title: `Toggle Jotai inspector ${identity}`,
        hideSelectors: [`${rootSelector} ${launcherSelector}`],
        isInstalled: (): boolean => readRoot(identity) !== undefined,
        isOpen: (): boolean => {
          const current = readRoot(identity);
          return current !== undefined && readShell(current) !== null;
        },
        open: (): void => {
          readRoot(identity)?.querySelector<HTMLButtonElement>(launcherSelector)?.click();
        },
        close: (): void => {
          const current = readRoot(identity);
          if (current !== undefined) readShell(current)?.querySelector<HTMLButtonElement>(closeSelector)?.click();
        },
      };
    });
}
