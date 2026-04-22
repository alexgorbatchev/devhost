import type { IExternalDevtoolsAdapter, IExternalDevtoolsLauncher } from "./types";

export function readInstalledExternalDevtoolsLaunchers(
  adapters: readonly IExternalDevtoolsAdapter[],
): IExternalDevtoolsLauncher[] {
  return adapters
    .filter((adapter) => adapter.isInstalled())
    .map((adapter) => ({
      id: adapter.id,
      isOpen: adapter.isOpen(),
      label: adapter.label,
      title: adapter.title,
    }));
}

export function readExternalDevtoolsLauncherStyleText(adapters: readonly IExternalDevtoolsAdapter[]): string {
  const selectors = adapters.flatMap((adapter) => adapter.hideSelectors).filter((selector) => selector.length > 0);

  return selectors.length === 0 ? "" : `${selectors.join(", ")} { display: none !important; }`;
}

export function areExternalDevtoolsLaunchersEqual(
  currentLaunchers: IExternalDevtoolsLauncher[],
  nextLaunchers: IExternalDevtoolsLauncher[],
): boolean {
  if (currentLaunchers.length !== nextLaunchers.length) {
    return false;
  }

  return currentLaunchers.every((launcher, index) => {
    const nextLauncher = nextLaunchers[index];

    return (
      launcher.id === nextLauncher?.id &&
      launcher.isOpen === nextLauncher.isOpen &&
      launcher.label === nextLauncher.label &&
      launcher.title === nextLauncher.title
    );
  });
}
