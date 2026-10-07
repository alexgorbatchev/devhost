import { onTestFinished } from "vitest";

import { placeElement, type IViewportRectangle } from "../../../../../../test-support/hostPageUtils";
import type { IReactFiberNode, IStandardSourceShape } from "../../../../shared/reactSourceInspection";

/** The development metadata React attaches to a host element, as far as component inspection reads it. */
export interface IComponentFiber extends IReactFiberNode {
  _debugSource: IStandardSourceShape;
}

/**
 * Adds a `Button` rendered by a `Toolbar` to the page at `rectangle`, both carrying React source metadata, and
 * returns the button's element.
 */
export function addInspectableButton(rectangle: IViewportRectangle): HTMLButtonElement {
  const toolbarFiber: IComponentFiber = {
    _debugSource: { columnNumber: 3, fileName: "/projects/shop/src/Toolbar.tsx", lineNumber: 18 },
    memoizedProps: { variant: "primary" },
    type: { displayName: "Toolbar" },
  };
  const buttonFiber: IComponentFiber = {
    _debugOwner: toolbarFiber,
    _debugSource: { columnNumber: 9, fileName: "/projects/shop/src/components/Button.tsx", lineNumber: 48 },
    memoizedProps: { disabled: false, label: "Save", style: { color: "red" } },
    type: { name: "Button" },
  };
  const button: HTMLButtonElement = document.createElement("button");

  button.textContent = "Save";
  Reflect.set(button, "__reactFiber$test", buttonFiber);
  placeElement(button, rectangle);
  document.body.append(button);

  return button;
}

/** Adds an element inside a rendered component menu at `rectangle`. */
export function addComponentMenuItem(rectangle: IViewportRectangle): HTMLButtonElement {
  const menu: HTMLDivElement = document.createElement("div");
  const item: HTMLButtonElement = document.createElement("button");

  menu.setAttribute("data-component-source-menu", "");
  placeElement(item, rectangle);
  menu.append(item);
  document.body.append(menu);

  return item;
}

/**
 * Records where the page tries to navigate for the rest of the test and keeps it where it is. A browser does not
 * let `location.assign` be replaced, and an editor URL would otherwise leave the test page.
 */
export function captureNavigations(): string[] {
  const urls: string[] = [];
  const listening = new AbortController();

  window.navigation.addEventListener(
    "navigate",
    (event: NavigateEvent): void => {
      urls.push(event.destination.url);
      event.preventDefault();
    },
    { signal: listening.signal },
  );
  onTestFinished((): void => listening.abort());

  return urls;
}
