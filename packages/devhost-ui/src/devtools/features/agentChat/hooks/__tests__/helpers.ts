import { placeElement } from "../../../../../../test-support/hostPageUtils";
import { userEvent } from "vitest/browser";

export async function scrollViewport(viewport: HTMLDivElement, deltaY: number): Promise<void> {
  const ended = Promise.withResolvers<void>();
  const expectedTop = Math.max(0, Math.min(viewport.scrollHeight - viewport.clientHeight, viewport.scrollTop + deltaY));
  const onEnd = (): void => {
    if (viewport.scrollTop !== expectedTop) return;
    viewport.removeEventListener("scrollend", onEnd);
    ended.resolve();
  };
  viewport.addEventListener("scrollend", onEnd);
  await userEvent.wheel(viewport, { delta: { y: deltaY } });
  await ended.promise;
}

export function createScrollViewport(): HTMLDivElement {
  const viewport = document.createElement("div");
  const content = document.createElement("div");
  placeElement(viewport, { x: 20, y: 20, width: 250, height: 250 });
  viewport.style.overflow = "auto";
  viewport.tabIndex = 0;
  content.style.width = "1000px";
  content.style.height = "2500px";
  viewport.append(content);
  document.body.append(viewport);
  return viewport;
}
