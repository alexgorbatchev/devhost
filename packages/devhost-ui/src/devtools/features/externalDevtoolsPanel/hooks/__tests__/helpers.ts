type HostAction = () => void;
type ApplyHostAction = (apply: HostAction) => void;

/** The parts of a TanStack Devtools shell that the host library renders into the page. */
export interface ITanStackDevtoolsShell {
  /** How often the page's own trigger and close button were activated. */
  activationCount: number;
  closeButton: HTMLButtonElement;
  panel: HTMLElement;
  root: HTMLElement;
  trigger: HTMLButtonElement;
}

/**
 * Adds a TanStack Devtools shell to the page. Its trigger opens the panel and its close button closes it, each
 * through `applyPanelState`, which a test replaces to make the host library respond later.
 */
export function addTanStackDevtoolsShell(
  applyPanelState: ApplyHostAction = (apply: HostAction): void => apply(),
): ITanStackDevtoolsShell {
  const root: HTMLDivElement = document.createElement("div");
  const panel: HTMLDivElement = document.createElement("div");
  const trigger: HTMLButtonElement = document.createElement("button");
  const closeButton: HTMLButtonElement = document.createElement("button");
  const shell: ITanStackDevtoolsShell = { activationCount: 0, closeButton, panel, root, trigger };

  root.setAttribute("data-testid", "tanstack_devtools");
  panel.setAttribute("data-testid", "tanstack-devtools-panel");
  panel.setAttribute("data-open", "false");
  trigger.setAttribute("data-tsd-control", "");
  trigger.setAttribute("aria-label", "Open TanStack Devtools");
  closeButton.setAttribute("data-testid", "tsd-close-button");

  trigger.addEventListener("click", (): void => {
    shell.activationCount += 1;
    applyPanelState((): void => panel.setAttribute("data-open", "true"));
  });
  closeButton.addEventListener("click", (): void => {
    shell.activationCount += 1;
    applyPanelState((): void => panel.setAttribute("data-open", "false"));
  });

  root.append(panel, trigger, closeButton);
  document.body.append(root);

  return shell;
}

/**
 * Adds standalone TanStack Router devtools to the page: a toggle and a panel that the toggle reveals after a short
 * CSS transition, the way the library animates it. Nothing in the page changes when the transition ends.
 */
export function addTanStackRouterDevtools(): void {
  const style: HTMLStyleElement = document.createElement("style");
  const footer: HTMLElement = document.createElement("footer");
  const toggle: HTMLButtonElement = document.createElement("button");
  const panel: HTMLDivElement = document.createElement("div");

  style.textContent = [
    ".TanStackRouterDevtoolsPanel { visibility: hidden; transition: visibility 0s linear 80ms; }",
    ".TanStackRouterDevtoolsPanel[data-shown] { visibility: visible; }",
  ].join("\n");
  footer.className = "TanStackRouterDevtools";
  panel.className = "TanStackRouterDevtoolsPanel";
  toggle.addEventListener("click", (): void => {
    panel.toggleAttribute("data-shown");
  });

  footer.append(toggle);
  document.body.append(style, footer, panel);
}

export function readHiddenLauncherStyle(): HTMLStyleElement | null {
  return document.head.querySelector<HTMLStyleElement>("style[data-devhost-external-devtools-style]");
}
