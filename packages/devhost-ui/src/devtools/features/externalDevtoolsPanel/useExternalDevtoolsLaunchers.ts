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

type SynchronizeLaunchers = () => void;

export function useExternalDevtoolsLaunchers(enabled: boolean): IExternalDevtoolsLaunchersResult {
  const [launchers, setLaunchers] = useState<IExternalDevtoolsLauncher[]>([]);
  const frameIdRef = useRef<number | null>(null);
  const launcherSyncFrameIdRef = useRef<number | null>(null);
  const synchronizeLaunchersRef = useRef<SynchronizeLaunchers | null>(null);
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

    synchronizeLaunchersRef.current = synchronizeLaunchers;

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
      attributes: true,
      attributeFilter: ["class", "style", "data-state", "hidden"],
    });

    return (): void => {
      observer.disconnect();

      if (frameIdRef.current !== null) {
        cancelAnimationFrame(frameIdRef.current);
        frameIdRef.current = null;
      }

      if (launcherSyncFrameIdRef.current !== null) {
        cancelAnimationFrame(launcherSyncFrameIdRef.current);
        launcherSyncFrameIdRef.current = null;
      }

      styleElement.remove();
      styleElementRef.current = null;
      synchronizeLaunchersRef.current = null;
    };
  }, [enabled, adapters]);

  function toggleLauncher(launcherId: string): void {
    const adapter = adapters.find((candidate) => candidate.id === launcherId);

    if (adapter === undefined) {
      return;
    }

    const expectedIsOpen = !adapter.isOpen();

    if (!expectedIsOpen) {
      adapter.close();
    } else {
      adapter.open();
    }

    synchronizeLaunchersUntilStateMatches(adapter, expectedIsOpen);
  }

  function synchronizeLaunchersUntilStateMatches(adapter: IExternalDevtoolsAdapter, expectedIsOpen: boolean): void {
    if (launcherSyncFrameIdRef.current !== null) {
      cancelAnimationFrame(launcherSyncFrameIdRef.current);
      launcherSyncFrameIdRef.current = null;
    }

    let remainingFrames = 60;

    const poll = (): void => {
      synchronizeLaunchersRef.current?.();

      if (adapter.isOpen() === expectedIsOpen || remainingFrames <= 0) {
        launcherSyncFrameIdRef.current = null;
        return;
      }

      remainingFrames -= 1;
      launcherSyncFrameIdRef.current = requestAnimationFrame(poll);
    };

    poll();
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
