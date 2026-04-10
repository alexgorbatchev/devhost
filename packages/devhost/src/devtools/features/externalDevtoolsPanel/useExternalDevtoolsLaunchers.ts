import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { externalDevtoolsDetectors } from "./externalDevtoolsDetectors";
import type { IExternalDevtoolsDetector, IExternalDevtoolsLauncher } from "./types";

interface IHiddenElementStyleState {
  displayPriority: string;
  displayValue: string;
}

interface IUseExternalDevtoolsLaunchersResult {
  launchers: IExternalDevtoolsLauncher[];
  triggerLauncher: (launcherId: string) => void;
}

export function useExternalDevtoolsLaunchers(enabled: boolean): IUseExternalDevtoolsLaunchersResult {
  const [availableLauncherIds, setAvailableLauncherIds] = useState<string[]>([]);
  const hiddenElementsRef = useRef<Map<HTMLElement, IHiddenElementStyleState>>(new Map());
  const launcherDefinitions = useMemo<readonly IExternalDevtoolsDetector[]>(() => externalDevtoolsDetectors, []);

  useEffect(() => {
    const hiddenElements = hiddenElementsRef.current;

    if (!enabled) {
      restoreHiddenElements(hiddenElements);
      setAvailableLauncherIds([]);
      return;
    }

    const synchronizeLaunchers = (): void => {
      const nextAvailableLauncherIds: string[] = [];
      const nextHiddenElements: HTMLElement[] = [];

      for (const detector of launcherDefinitions) {
        const detectedLauncher = detector.detect();

        if (detectedLauncher === null) {
          continue;
        }

        nextAvailableLauncherIds.push(detector.id);
        nextHiddenElements.push(...detectedLauncher.hiddenElements);
      }

      setAvailableLauncherIds((currentLauncherIds) =>
        areLauncherListsEqual(currentLauncherIds, nextAvailableLauncherIds)
          ? currentLauncherIds
          : nextAvailableLauncherIds,
      );
      synchronizeHiddenElements(hiddenElements, nextHiddenElements);
    };

    synchronizeLaunchers();

    const observer = new MutationObserver(() => {
      synchronizeLaunchers();
    });

    observer.observe(document.documentElement, {
      attributes: true,
      childList: true,
      subtree: true,
    });

    return (): void => {
      observer.disconnect();
      restoreHiddenElements(hiddenElements);
    };
  }, [enabled, launcherDefinitions]);

  const launchers = useMemo<IExternalDevtoolsLauncher[]>(() => {
    return availableLauncherIds
      .map((launcherId) => launcherDefinitions.find((detector) => detector.id === launcherId) ?? null)
      .filter((detector): detector is IExternalDevtoolsDetector => detector !== null)
      .map((detector) => ({
        id: detector.id,
        label: detector.label,
        title: detector.title,
      }));
  }, [availableLauncherIds, launcherDefinitions]);

  function triggerLauncher(launcherId: string): void {
    const detector = launcherDefinitions.find((candidate) => candidate.id === launcherId);
    const detectedLauncher = detector?.detect() ?? null;

    detectedLauncher?.launcherElement.click();
  }

  return {
    launchers,
    triggerLauncher,
  };
}

function synchronizeHiddenElements(
  hiddenElements: Map<HTMLElement, IHiddenElementStyleState>,
  nextHiddenElements: HTMLElement[],
): void {
  const nextHiddenElementSet: Set<HTMLElement> = new Set(nextHiddenElements);

  for (const [element, styleState] of hiddenElements) {
    if (nextHiddenElementSet.has(element) && element.isConnected) {
      continue;
    }

    restoreHiddenElement(element, styleState);
    hiddenElements.delete(element);
  }

  for (const element of nextHiddenElementSet) {
    if (hiddenElements.has(element)) {
      continue;
    }

    hiddenElements.set(element, {
      displayPriority: element.style.getPropertyPriority("display"),
      displayValue: element.style.getPropertyValue("display"),
    });
    element.style.setProperty("display", "none", "important");
  }
}

function restoreHiddenElements(hiddenElements: Map<HTMLElement, IHiddenElementStyleState>): void {
  for (const [element, styleState] of hiddenElements) {
    restoreHiddenElement(element, styleState);
  }

  hiddenElements.clear();
}

function restoreHiddenElement(element: HTMLElement, styleState: IHiddenElementStyleState): void {
  if (!element.isConnected) {
    return;
  }

  if (styleState.displayValue.length === 0) {
    element.style.removeProperty("display");
    return;
  }

  element.style.setProperty("display", styleState.displayValue, styleState.displayPriority);
}

function areLauncherListsEqual(currentLauncherIds: string[], nextLauncherIds: string[]): boolean {
  if (currentLauncherIds.length !== nextLauncherIds.length) {
    return false;
  }

  return currentLauncherIds.every((launcherId, index) => launcherId === nextLauncherIds[index]);
}
