import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { useReloadHold } from "../useReloadHold";

interface IReloadWatcher {
  readWasHeld: () => boolean | null;
}

let stopWatching: VoidFunction | null = null;

/** A listener after the hook's reads what it decided, and cancels the reload itself so the test page survives. */
function watchReloads(): IReloadWatcher {
  let wasHeld: boolean | null = null;
  const watch = (event: NavigateEvent): void => {
    wasHeld = event.defaultPrevented;
    event.preventDefault();
  };
  window.navigation.addEventListener("navigate", watch);
  stopWatching = () => window.navigation.removeEventListener("navigate", watch);
  return { readWasHeld: () => wasHeld };
}

afterEach(() => {
  stopWatching?.();
  stopWatching = null;
});

test("holds a reload a script asks for and reports it", async () => {
  const hook = renderHook(() => useReloadHold(true));
  const watcher = watchReloads();
  expect(hook.result.current.isAvailable).toBe(true);
  expect(hook.result.current.isBlocked).toBe(false);
  await act(async () => {
    window.location.reload();
  });
  expect(watcher.readWasHeld()).toBe(true);
  expect(hook.result.current.isBlocked).toBe(true);
  hook.unmount();
});

test("dismissing clears the notice and the next reload raises it again", async () => {
  const hook = renderHook(() => useReloadHold(true));
  watchReloads();
  await act(async () => {
    window.location.reload();
  });
  act(() => hook.result.current.dismiss());
  expect(hook.result.current.isBlocked).toBe(false);
  await act(async () => {
    window.location.reload();
  });
  expect(hook.result.current.isBlocked).toBe(true);
  hook.unmount();
});

test("leaves other navigations alone", async () => {
  const hook = renderHook(() => useReloadHold(true));
  const watcher = watchReloads();
  await act(async () => {
    window.location.hash = "other";
  });
  expect(watcher.readWasHeld()).toBe(false);
  expect(hook.result.current.isBlocked).toBe(false);
  hook.unmount();
});

test("holds nothing while off", async () => {
  const hook = renderHook(() => useReloadHold(false));
  const watcher = watchReloads();
  await act(async () => {
    window.location.reload();
  });
  expect(watcher.readWasHeld()).toBe(false);
  expect(hook.result.current.isBlocked).toBe(false);
  hook.unmount();
});

test("turning it off clears the notice and stops holding", async () => {
  const hook = renderHook(({ isEnabled }) => useReloadHold(isEnabled), { initialProps: { isEnabled: true } });
  const watcher = watchReloads();
  await act(async () => {
    window.location.reload();
  });
  hook.rerender({ isEnabled: false });
  expect(hook.result.current.isBlocked).toBe(false);
  await act(async () => {
    window.location.reload();
  });
  expect(watcher.readWasHeld()).toBe(false);
  hook.unmount();
});
