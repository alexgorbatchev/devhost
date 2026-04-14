import { useEffect, useMemo, useRef, useState } from "react";

import { externalDevtoolsDetectors } from "./externalDevtoolsDetectors";
import {
  areExternalDevtoolsLaunchersEqual,
  readExternalDevtoolsLauncherStyleText,
  readInstalledExternalDevtoolsLaunchers,
} from "./externalDevtoolsState";
import type { IExternalDevtoolsAdapter, IExternalDevtoolsLauncher } from "./types";

interface IExternalDevtoolsLaunchersResult {
  launchers: IExternalDevtoolsLauncher[];
  toggleLauncher: (launcherId: string) => void;
}

export function useExternalDevtoolsLaunchers(enabled: boolean): IExternalDevtoolsLaunchersResult {
  const [launchers, setLaunchers] = useState<IExternalDevtoolsLauncher[]>([]);
  const frameIdRef = useRef<number | null>(null);
  const styleElementRef = useRef<HTMLStyleElement | null>(null);
  const adapters = useMemo<readonly IExternalDevtoolsAdapter[]>(() => externalDevtoolsDetectors, []);

  useEffect(() => {
    const styleElement = styleElementRef.current ?? createHiddenLauncherStyleElement();

    styleElementRef.current = styleElement;

    if (!enabled) {
      setLaunchers([]);
      styleElement.remove();
      styleElementRef.current = null;
      return;
    }

    const synchronizeLaunchers = (): void => {
      const installedAdapters = adapters.filter((adapter) => adapter.isInstalled());
      const nextLaunchers = readInstalledExternalDevtoolsLaunchers(installedAdapters);

      setLaunchers((currentLaunchers) =>
        areExternalDevtoolsLaunchersEqual(currentLaunchers, nextLaunchers) ? currentLaunchers : nextLaunchers,
      );
      synchronizeHiddenLauncherStyle(styleElement, installedAdapters);
    };

    const scheduleSynchronizeLaunchers = (): void => {
      if (frameIdRef.current !== null) {
        return;
      }

      frameIdRef.current = requestAnimationFrame(() => {
        frameIdRef.current = null;
        synchronizeLaunchers();
      });
    };

    if (!styleElement.isConnected) {
      document.head.append(styleElement);
    }

    synchronizeLaunchers();

    const observer = new MutationObserver(() => {
      scheduleSynchronizeLaunchers();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return (): void => {
      observer.disconnect();

      if (frameIdRef.current !== null) {
        cancelAnimationFrame(frameIdRef.current);
        frameIdRef.current = null;
      }

      styleElement.remove();
      styleElementRef.current = null;
    };
  }, [enabled, adapters]);

  function toggleLauncher(launcherId: string): void {
    const adapter = adapters.find((candidate) => candidate.id === launcherId);

    if (adapter === undefined) {
      return;
    }

    if (adapter.isOpen()) {
      adapter.close();
      return;
    }

    adapter.open();
  }

  return {
    launchers,
    toggleLauncher,
  };
}

function synchronizeHiddenLauncherStyle(
  styleElement: HTMLStyleElement,
  installedAdapters: readonly IExternalDevtoolsAdapter[],
): void {
  const nextText = readExternalDevtoolsLauncherStyleText(installedAdapters);

  if (styleElement.textContent === nextText) {
    return;
  }

  styleElement.textContent = nextText;
}

function createHiddenLauncherStyleElement(): HTMLStyleElement {
  const styleElement = document.createElement("style");

  styleElement.setAttribute("data-devhost-external-devtools-style", "");

  return styleElement;
}
