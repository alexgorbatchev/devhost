import type { IExternalDevtoolsAdapter } from "./types";

const launcherSelector: string = 'button[title="Show dev panel"]:has(> svg[aria-label="React Hook Form Logo"])';
const closeSelector: string = 'header > button[title="Close dev panel"]';

type ReadAdapters = () => IExternalDevtoolsAdapter[];

/** Discover 4.4.0 inspectors without altering their DOM or retaining native launcher nodes. */
export function createReactHookFormDevtoolsDetector(hostDocument: Document): ReadAdapters {
  const identities = new WeakMap<HTMLElement, number>();
  let nextIdentity = 1;

  function readPanels(): HTMLElement[] {
    return Array.from(hostDocument.querySelectorAll<HTMLButtonElement>(closeSelector)).flatMap((button) => {
      const header = button.parentElement;
      const panel = header?.parentElement;
      const heading = header?.querySelector("p")?.textContent?.replace(/\s+/gu, " ").trim();

      if (
        heading !== "■ React Hook Form" ||
        panel === undefined ||
        panel === null ||
        panel.querySelector('input[placeholder="Filter name..."]') === null ||
        panel.querySelector('button[title="Toggle entire fields"]') === null
      ) {
        return [];
      }

      return [panel];
    });
  }

  function readPanel(identity: number): HTMLElement | undefined {
    return readPanels().find((panel) => identities.get(panel) === identity);
  }

  function readLauncher(panel: HTMLElement): Element | null {
    let sibling = panel.parentElement?.nextElementSibling ?? null;

    // Emotion may insert a stylesheet between the animation wrapper and button.
    while (sibling?.tagName === "STYLE") {
      sibling = sibling.nextElementSibling;
    }

    return sibling?.matches(launcherSelector) ? sibling : null;
  }

  function isOpen(identity: number): boolean {
    const panel = readPanel(identity);
    return panel !== undefined && readLauncher(panel) === null;
  }

  function open(identity: number): void {
    const panel = readPanel(identity);
    if (panel === undefined) {
      return;
    }

    // In 4.4.0 the SVG owns the open handler; clicking its parent button does nothing.
    readLauncher(panel)
      ?.querySelector('svg[aria-label="React Hook Form Logo"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  }

  function close(identity: number): void {
    readPanel(identity)?.querySelector<HTMLButtonElement>(closeSelector)?.click();
  }

  return (): IExternalDevtoolsAdapter[] =>
    readPanels().map((panel) => {
      const identity = identities.get(panel) ?? nextIdentity++;
      identities.set(panel, identity);

      return {
        id: `react-hook-form-${identity}`,
        label: `Form ${identity}`,
        title: `Toggle React Hook Form inspector ${identity}`,
        hideSelectors: [launcherSelector],
        isInstalled: (): boolean => readPanel(identity) !== undefined,
        isOpen: (): boolean => isOpen(identity),
        open: (): void => open(identity),
        close: (): void => close(identity),
      };
    });
}
