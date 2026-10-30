import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { useHotReloadClient } from "../useHotReloadClient";

const addedElements: Element[] = [];

function addToBody(tagName: string): void {
  const element = document.createElement(tagName);
  addedElements.push(element);
  document.body.append(element);
}

/** Lets the observers deliver what they already hold, which they do in a task of their own. */
function settleObservers(change?: VoidFunction): Promise<void> {
  return act(async () => {
    change?.();
    await new Promise((resolve) => setTimeout(resolve));
  });
}

afterEach(() => {
  for (const element of addedElements.splice(0)) element.remove();
  Reflect.deleteProperty(window, "webpackHotUpdate_app");
});

test("reads a client that is already on the page", async () => {
  const script = document.createElement("script");
  script.setAttribute("data-bun-dev-server-script", "");
  addedElements.push(script);
  document.head.append(script);
  const { result } = renderHook(() => useHotReloadClient());
  expect(result.current).toBe("bun");
  await settleObservers();
});

test("notices a client whose marker appears after the devtools mount", async () => {
  const { result, unmount } = renderHook(() => useHotReloadClient());
  await settleObservers();
  await settleObservers(() => addToBody("nextjs-portal"));
  expect(result.current).toBe("next");
  // Before the cleanup removes the marker, which the hook would otherwise see outside `act`.
  unmount();
});

test("stops watching the page when it unmounts", async () => {
  const { result, unmount } = renderHook(() => useHotReloadClient());
  await settleObservers();
  const clientWhileMounted = result.current;
  unmount();
  addToBody("nextjs-portal");
  await settleObservers();
  expect(result.current).toBe(clientWhileMounted);
});
