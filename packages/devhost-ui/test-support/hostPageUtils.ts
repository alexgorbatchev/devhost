import { DEVTOOLS_ROOT_ATTRIBUTE_NAME } from "../src/devtools/shared/constants";

/** Where an element sits in the viewport, in CSS pixels. */
export interface IViewportRectangle {
  height: number;
  width: number;
  x: number;
  y: number;
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

/**
 * Puts `element` at `rectangle` in page coordinates, so it moves through the viewport when the page scrolls.
 * The page scrolls only after `makePageScrollable`.
 */
export function placeElementOnPage(element: HTMLElement, rectangle: IViewportRectangle): void {
  placeElement(element, rectangle);
  element.style.position = "absolute";
}

/** Makes the host page several viewports tall, so wheel input scrolls it. */
export function makePageScrollable(): void {
  const filler: HTMLDivElement = document.createElement("div");

  filler.style.height = "3000px";
  document.body.append(filler);
}

/**
 * Adds an empty frame to the host page at `rectangle`. A press inside it moves the focus out of the test's own
 * window, which then receives `blur`.
 */
export function addHostFrame(rectangle: IViewportRectangle): HTMLIFrameElement {
  const frame: HTMLIFrameElement = document.createElement("iframe");

  frame.srcdoc = "<!doctype html><title>Embedded page</title>";
  placeElement(frame, rectangle);
  document.body.append(frame);

  return frame;
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

export function waitForAnimationFrame(): Promise<void> {
  const frame = Promise.withResolvers<void>();

  requestAnimationFrame((): void => {
    frame.resolve();
  });

  return frame.promise;
}
