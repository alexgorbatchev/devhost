import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, assert, beforeEach, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { createDevtoolsSettingsStore } from "../../../../shared/createDevtoolsSettingsStore";
import type { DevtoolsSettingsStore } from "../../../../shared/types";
import { resetDevtoolsSettingsStorage } from "../../../../../../test-support/resetDevtoolsSettingsStorage";
import { waitForAnimationFrame } from "../../../../../../test-support/hostPageUtils";
import { useChatScrollPosition } from "../useChatScrollPosition";
import { createScrollViewport, scrollViewport } from "./helpers";

let settingsStore: DevtoolsSettingsStore;
let restoreStorage: VoidFunction;
beforeEach(() => {
  restoreStorage = resetDevtoolsSettingsStorage();
  settingsStore = createDevtoolsSettingsStore(
    { projectRootPath: "/scroll-test", pageURL: window.location.href },
    () => localStorage,
  );
});
afterEach(() => restoreStorage());

test("waits for replay before restoring, then saves real wheel scrolling", async () => {
  settingsStore.getState().updateChat({ scroll: { top: 600, left: 30, isAtBottom: false } });
  const viewport = createScrollViewport();
  const hook = renderHook(
    ({ isReady }) => useChatScrollPosition({ settingsStore, isReady, isOpen: true, sessionId: "one" }),
    { initialProps: { isReady: false } },
  );
  const ref = hook.result.current.ref;
  assert(typeof ref === "function");
  await act(async () => {
    ref(viewport);
    await waitForAnimationFrame();
  });
  expect(viewport.scrollTop).toBe(0);
  expect(settingsStore.getState().chat.scroll?.top).toBe(600);
  await act(async () => {
    hook.rerender({ isReady: true });
  });
  await waitFor(() => expect(viewport.scrollTop).toBe(600));
  expect(viewport.scrollLeft).toBe(30);
  await act(async () => {
    await scrollViewport(viewport, 200);
  });
  await waitFor(() => expect(settingsStore.getState().chat.scroll?.top).toBe(800));
  expect(settingsStore.getState().chat.scroll?.isAtBottom).toBe(false);
  hook.unmount();
  await scrollViewport(viewport, 100);
  await waitFor(() => expect(viewport.scrollTop).toBe(900));
  expect(settingsStore.getState().chat.scroll?.top).toBe(800);
});

test("a collapsed viewport retains its saved reading position until it is reopened", async () => {
  settingsStore.getState().updateChat({ scroll: { top: 500, left: 0, isAtBottom: false } });
  const viewport = createScrollViewport();
  viewport.hidden = true;
  const hook = renderHook(
    ({ isOpen }) => useChatScrollPosition({ settingsStore, isOpen, isReady: true, sessionId: "one" }),
    { initialProps: { isOpen: false } },
  );
  const ref = hook.result.current.ref;
  assert(typeof ref === "function");
  await act(async () => {
    ref(viewport);
    await waitForAnimationFrame();
  });
  expect(settingsStore.getState().chat.scroll?.top).toBe(500);
  viewport.hidden = false;
  await act(async () => {
    hook.rerender({ isOpen: true });
  });
  await waitFor(() => expect(viewport.scrollTop).toBe(500));
  viewport.hidden = true;
  await act(async () => {
    hook.rerender({ isOpen: false });
    await waitForAnimationFrame();
  });
  expect(settingsStore.getState().chat.scroll?.top).toBe(500);
  viewport.hidden = false;
  await act(async () => {
    hook.rerender({ isOpen: true });
  });
  await waitFor(() => expect(viewport.scrollTop).toBe(500));
});

test("a saved bottom position follows the end of a longer replay", async () => {
  settingsStore.getState().updateChat({ scroll: { top: 100, left: 0, isAtBottom: true } });
  const viewport = createScrollViewport();
  const hook = renderHook(() =>
    useChatScrollPosition({ settingsStore, isOpen: true, isReady: true, sessionId: "one" }),
  );
  const ref = hook.result.current.ref;
  assert(typeof ref === "function");
  await act(async () => {
    ref(viewport);
  });
  await waitFor(() => expect(viewport.scrollTop).toBe(viewport.scrollHeight - viewport.clientHeight));
  await act(async () => {
    await scrollViewport(viewport, -200);
  });
  await waitFor(() => expect(settingsStore.getState().chat.scroll?.isAtBottom).toBe(false));
});

test("an empty view keeps native initialization and records keyboard scrolling to the bottom", async () => {
  const viewport = createScrollViewport();
  const hook = renderHook(() =>
    useChatScrollPosition({ settingsStore, isOpen: true, isReady: true, sessionId: undefined }),
  );
  expect(hook.result.current.scrollToBottomOnInitialize).toBe(true);
  const ref = hook.result.current.ref;
  assert(typeof ref === "function");
  await act(async () => {
    ref(viewport);
    await waitForAnimationFrame();
  });
  await act(async () => {
    await userEvent.click(viewport);
    await userEvent.keyboard("{End}");
  });
  await waitFor(() => expect(viewport.scrollTop).toBe(viewport.scrollHeight - viewport.clientHeight));
  await waitFor(() => expect(settingsStore.getState().chat.scroll?.isAtBottom).toBe(true));
});
