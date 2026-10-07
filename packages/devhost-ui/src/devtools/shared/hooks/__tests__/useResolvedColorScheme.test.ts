import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cdp } from "vitest/browser";

import type { DevtoolsColorScheme } from "../../DevtoolsColorScheme";
import { useResolvedColorScheme } from "../useResolvedColorScheme";

type HostPageChange = () => void;

/** Makes Chromium report `colorScheme` as the operating system preference. The test browser starts on light. */
async function preferSystemColorScheme(colorScheme: DevtoolsColorScheme): Promise<void> {
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: colorScheme }],
  });
}

function declareHostThemeRules(): void {
  const style: HTMLStyleElement = document.createElement("style");

  style.textContent = ':root.night, :root[data-theme="night"] { color-scheme: dark; }';
  document.body.append(style);
}

// The hook learns about host changes from a mutation observer, which reports in a microtask.
async function changeHostPage(change: HostPageChange): Promise<void> {
  await act(async (): Promise<void> => {
    change();
  });
}

// Changes the preference under a mounted hook and waits until Chromium has reported it. Media query lists hear about
// a change in the order they were created, so the hook has heard by the time this later list does.
async function changeSystemColorScheme(colorScheme: DevtoolsColorScheme): Promise<void> {
  const reported = Promise.withResolvers<void>();

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (): void => reported.resolve(), {
    once: true,
  });

  await act(async (): Promise<void> => {
    await preferSystemColorScheme(colorScheme);
    await reported.promise;
  });
}

afterEach(async () => {
  // Unmount first, so restoring the preference does not reach a hook that is still listening.
  cleanup();
  vi.restoreAllMocks();
  document.documentElement.removeAttribute("class");
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("style");
  await preferSystemColorScheme("light");
});

describe("useResolvedColorScheme", () => {
  test("resolves a dark host document while the system prefers light", () => {
    document.documentElement.style.setProperty("color-scheme", "dark");

    expect(renderHook(() => useResolvedColorScheme()).result.current).toBe("dark");
  });

  test("resolves a light host document while the system prefers dark", async () => {
    await preferSystemColorScheme("dark");
    document.documentElement.style.setProperty("color-scheme", "light");

    expect(renderHook(() => useResolvedColorScheme()).result.current).toBe("light");
  });

  test("uses the system preference while the document declares no scheme", async () => {
    const lightHook = renderHook(() => useResolvedColorScheme());

    expect(lightHook.result.current).toBe("light");
    lightHook.unmount();

    await preferSystemColorScheme("dark");

    expect(renderHook(() => useResolvedColorScheme()).result.current).toBe("dark");
  });

  test("uses the system preference while the document supports both schemes", async () => {
    await preferSystemColorScheme("dark");
    document.documentElement.style.setProperty("color-scheme", "light dark");

    expect(renderHook(() => useResolvedColorScheme()).result.current).toBe("dark");
  });

  test("follows host theme changes made through a class, data-theme, or inline style", async () => {
    declareHostThemeRules();
    const hook = renderHook(() => useResolvedColorScheme());

    expect(hook.result.current).toBe("light");

    await changeHostPage(() => document.documentElement.classList.add("night"));
    expect(hook.result.current).toBe("dark");

    await changeHostPage(() => document.documentElement.classList.remove("night"));
    expect(hook.result.current).toBe("light");

    await changeHostPage(() => document.documentElement.setAttribute("data-theme", "night"));
    expect(hook.result.current).toBe("dark");

    await changeHostPage(() => document.documentElement.removeAttribute("data-theme"));
    expect(hook.result.current).toBe("light");

    await changeHostPage(() => document.documentElement.style.setProperty("color-scheme", "dark"));
    expect(hook.result.current).toBe("dark");
  });

  test("follows the system preference when it changes", async () => {
    const hook = renderHook(() => useResolvedColorScheme());

    expect(hook.result.current).toBe("light");

    await changeSystemColorScheme("dark");
    expect(hook.result.current).toBe("dark");

    await changeSystemColorScheme("light");
    expect(hook.result.current).toBe("light");
  });

  test("stops watching the host document and the system preference when it unmounts", () => {
    const addListener = vi.spyOn(MediaQueryList.prototype, "addEventListener");
    const removeListener = vi.spyOn(MediaQueryList.prototype, "removeEventListener");
    const disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
    const hook = renderHook(() => useResolvedColorScheme());

    expect(addListener.mock.calls).toHaveLength(1);
    expect(removeListener.mock.calls).toHaveLength(0);
    expect(disconnect).toHaveBeenCalledTimes(0);

    hook.unmount();
    expect(removeListener.mock.calls).toEqual(addListener.mock.calls);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
