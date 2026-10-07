import { DEVTOOLS_ROOT_ATTRIBUTE_NAME } from "../src/devtools/shared/constants";

/** Where an element sits in the viewport, in CSS pixels. */
export interface IViewportRectangle {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface IViewportPoint {
  clientX: number;
  clientY: number;
}

/** Fixes `element` at `rectangle`, so its layout and hit testing are exactly what a test states. */
export function placeElement(element: HTMLElement, rectangle: IViewportRectangle): void {
  Object.assign(element.style, {
    border: "0",
    boxSizing: "border-box",
    height: `${rectangle.height}px`,
    left: `${rectangle.x}px`,
    margin: "0",
    padding: "0",
    position: "fixed",
    top: `${rectangle.y}px`,
    width: `${rectangle.width}px`,
  });
}

/** Adds a button to the host page at `rectangle`. */
export function addHostButton(id: string, text: string, rectangle: IViewportRectangle): HTMLButtonElement {
  const button: HTMLButtonElement = document.createElement("button");

  button.id = id;
  button.textContent = text;
  placeElement(button, rectangle);
  document.body.append(button);

  return button;
}

/** Adds a button inside a devtools host, where page-level features must not interfere. */
export function addDevtoolsButton(rectangle: IViewportRectangle): HTMLButtonElement {
  const host: HTMLDivElement = document.createElement("div");
  const button: HTMLButtonElement = document.createElement("button");

  host.setAttribute(DEVTOOLS_ROOT_ATTRIBUTE_NAME, "");
  placeElement(button, rectangle);
  host.append(button);
  document.body.append(host);

  return button;
}

/** The point at the center of `element`, for pointer events that the page hit-tests. */
export function readCenter(element: Element): IViewportPoint {
  const rectangle: DOMRect = element.getBoundingClientRect();

  return { clientX: rectangle.left + rectangle.width / 2, clientY: rectangle.top + rectangle.height / 2 };
}

export function waitForAnimationFrame(): Promise<void> {
  const frame = Promise.withResolvers<void>();

  requestAnimationFrame((): void => {
    frame.resolve();
  });

  return frame.promise;
}
