import { useCallback, useEffect, useState } from "preact/hooks";

import { readDevtoolsComponentEditorLabel, type DevtoolsComponentEditor } from "../../../devtoolsComponentEditor";
import { DEVTOOLS_ROOT_ATTRIBUTE_NAME } from "../../shared/constants";
import { resolveAnnotationTarget } from "../annotationComposer/resolveAnnotationTarget";
import type { ITerminalSessionStartResult } from "../terminalSessions/types";
import { createComponentSourceUrl, formatComponentSourcePath } from "./componentSourceUtils";
import { inspectComponentElement } from "./inspectComponentElement";
import type { ComponentSourceMenuItem, IComponentSourceMenuState, ISetComponentMenuFunction } from "./types";

type UseComponentSourceNavigationParams = {
  componentEditor: DevtoolsComponentEditor;
  projectRootPath: string;
  startComponentSourceSession: (menuItem: ComponentSourceMenuItem) => Promise<ITerminalSessionStartResult>;
};

type UseComponentSourceNavigationResult = {
  closeComponentMenu: () => void;
  componentMenu: IComponentSourceMenuState | null;
  openComponentSource: (index: number) => Promise<void>;
};

export function useComponentSourceNavigation({
  componentEditor,
  projectRootPath,
  startComponentSourceSession,
}: UseComponentSourceNavigationParams): UseComponentSourceNavigationResult {
  const [componentMenu, setComponentMenu] = useState<IComponentSourceMenuState | null>(null);

  const closeComponentMenu = useCallback((): void => {
    setComponentMenu(null);
  }, []);

  const setComponentMenuErrorMessage = useCallback((errorMessage: string): void => {
    setComponentMenu((currentMenu: IComponentSourceMenuState | null): IComponentSourceMenuState | null => {
      if (currentMenu === null) {
        return null;
      }

      return {
        ...currentMenu,
        errorMessage,
      };
    });
  }, []);

  const openComponentSource = useCallback(
    async (index: number): Promise<void> => {
      const menuItem: ComponentSourceMenuItem | undefined = componentMenu?.items[index];

      if (menuItem === undefined) {
        return;
      }

      const sourcePath: string = formatComponentSourcePath(menuItem.source, projectRootPath);

      if (typeof navigator === "object" && navigator.clipboard !== undefined) {
        try {
          await navigator.clipboard.writeText(sourcePath);
        } catch {
          // Ignore clipboard failures and still attempt editor navigation.
        }
      }

      if (menuItem.action.kind === "external-editor") {
        window.location.assign(menuItem.action.sourceUrl);
        closeComponentMenu();
        return;
      }

      const startResult: ITerminalSessionStartResult = await startComponentSourceSession(menuItem);

      if (!startResult.success) {
        setComponentMenuErrorMessage(startResult.errorMessage ?? "Failed to start the Neovim session.");
        return;
      }

      closeComponentMenu();
    },
    [closeComponentMenu, componentMenu, projectRootPath, setComponentMenuErrorMessage, startComponentSourceSession],
  );

  useEffect(() => {
    const handleContextMenu = (event: MouseEvent): void => {
      if (!event.altKey) {
        closeComponentMenu();
        return;
      }

      if (isEventInsideDevtools(event)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const targetElement: HTMLElement | null = resolveAnnotationTarget(event.clientX, event.clientY);

      if (targetElement === null) {
        closeComponentMenu();
        return;
      }

      void openComponentMenu(
        targetElement,
        event.clientX,
        event.clientY,
        componentEditor,
        projectRootPath,
        setComponentMenu,
      );
    };

    document.addEventListener("contextmenu", handleContextMenu, true);

    return () => {
      document.removeEventListener("contextmenu", handleContextMenu, true);
    };
  }, [closeComponentMenu, componentEditor, projectRootPath]);

  useEffect(() => {
    if (componentMenu === null) {
      return;
    }

    const handlePointerDown = (event: MouseEvent): void => {
      if (isEventInsideComponentMenu(event)) {
        return;
      }

      closeComponentMenu();
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      closeComponentMenu();
    };

    document.addEventListener("mousedown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [closeComponentMenu, componentMenu]);

  return {
    closeComponentMenu,
    componentMenu,
    openComponentSource,
  };
}

async function openComponentMenu(
  targetElement: HTMLElement,
  x: number,
  y: number,
  componentEditor: DevtoolsComponentEditor,
  projectRootPath: string,
  setComponentMenu: ISetComponentMenuFunction,
): Promise<void> {
  const inspectedComponents = await inspectComponentElement(targetElement);

  if (inspectedComponents.length === 0) {
    setComponentMenu(null);
    return;
  }

  setComponentMenu({
    items: inspectedComponents.map((inspection, index): ComponentSourceMenuItem => {
      const sourceLabel: string = formatComponentSourcePath(inspection.source, projectRootPath);

      return createMenuItem(inspection, index, sourceLabel, componentEditor, projectRootPath);
    }),
    title: `Open in ${readDevtoolsComponentEditorLabel(componentEditor)}`,
    x,
    y,
  });
}

function createMenuItem(
  inspection: Awaited<ReturnType<typeof inspectComponentElement>>[number],
  index: number,
  sourceLabel: string,
  componentEditor: DevtoolsComponentEditor,
  projectRootPath: string,
): ComponentSourceMenuItem {
  const props = Object.entries(inspection.props).map(([name, value]) => {
    return {
      name,
      title: `${name}=${value}`,
    };
  });

  if (componentEditor === "neovim") {
    return {
      action: {
        kind: "neovim",
      },
      displayName: inspection.displayName,
      key: `${sourceLabel}:${index}`,
      props,
      source: inspection.source,
      sourceLabel,
    };
  }

  return {
    action: {
      kind: "external-editor",
      sourceUrl: createComponentSourceUrl(inspection.source, componentEditor, projectRootPath),
    },
    displayName: inspection.displayName,
    key: `${sourceLabel}:${index}`,
    props,
    source: inspection.source,
    sourceLabel,
  };
}

function getEventTargetElement(event: Event): HTMLElement | null {
  const eventPath = event.composedPath();

  for (const eventTarget of eventPath) {
    if (eventTarget instanceof HTMLElement) {
      return eventTarget;
    }
  }

  return event.target instanceof HTMLElement ? event.target : null;
}

function isEventInsideComponentMenu(event: Event): boolean {
  const targetElement: HTMLElement | null = getEventTargetElement(event);

  return targetElement?.closest("[data-component-source-menu]") !== null;
}

function isEventInsideDevtools(event: Event): boolean {
  for (const eventTarget of event.composedPath()) {
    if (!(eventTarget instanceof HTMLElement)) {
      continue;
    }

    if (eventTarget.hasAttribute(DEVTOOLS_ROOT_ATTRIBUTE_NAME)) {
      return true;
    }
  }

  return false;
}
