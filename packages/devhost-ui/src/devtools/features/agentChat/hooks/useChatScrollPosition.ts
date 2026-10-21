import type { ThreadPrimitive } from "@assistant-ui/react";
import { useLayoutEffect, useState, type ComponentPropsWithRef } from "react";
import { useStore } from "zustand";
import type { DevtoolsSettingsStore, IChatScrollPosition } from "../../../shared/types";

interface IChatScrollOptions {
  settingsStore: DevtoolsSettingsStore;
  isOpen: boolean;
  isReady: boolean;
  sessionId: string | undefined;
}
type ChatViewportBinding = Pick<
  ComponentPropsWithRef<typeof ThreadPrimitive.Viewport>,
  | "autoScroll"
  | "ref"
  | "scrollToBottomOnInitialize"
  | "scrollToBottomOnRunStart"
  | "scrollToBottomOnThreadSwitch"
  | "turnAnchor"
>;

export function useChatScrollPosition({
  settingsStore,
  isOpen,
  isReady,
  sessionId,
}: IChatScrollOptions): ChatViewportBinding {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const hasSavedPosition = useStore(settingsStore, (state) => state.chat.scroll !== null);
  const isReaderAtBottom = useStore(settingsStore, (state) => state.chat.scroll?.isAtBottom ?? true);
  useLayoutEffect(() => {
    if (!viewport || !isOpen || !isReady) return;
    let isRestoring = settingsStore.getState().chat.scroll !== null;
    let frame = 0;
    const restore = (): void => {
      if (viewport.clientHeight === 0) return;
      const saved = settingsStore.getState().chat.scroll;
      if (saved)
        viewport.scrollTo({
          top: saved.isAtBottom ? viewport.scrollHeight : saved.top,
          left: saved.left,
          behavior: "instant",
        });
      isRestoring = false;
      observer.disconnect();
    };
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(restore);
    });
    observer.observe(viewport);
    if (viewport.firstElementChild) observer.observe(viewport.firstElementChild);
    frame = requestAnimationFrame(restore);
    const save = (): void => {
      if (isRestoring || viewport.clientHeight === 0) return;
      const scroll: IChatScrollPosition = {
        top: Math.max(0, viewport.scrollTop),
        left: Math.max(0, viewport.scrollLeft),
        isAtBottom: viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 1,
      };
      const previous = settingsStore.getState().chat.scroll;
      if (previous?.top === scroll.top && previous.left === scroll.left && previous.isAtBottom === scroll.isAtBottom)
        return;
      settingsStore.getState().updateChat({ scroll });
    };
    viewport.addEventListener("scroll", save, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      viewport.removeEventListener("scroll", save);
    };
  }, [isOpen, isReady, sessionId, settingsStore, viewport]);
  // Saved reading positions opt out of native initialization, thread-switch and run-start jumps.
  // Native bottom anchoring follows new replies only while the reader remains at the bottom.
  return {
    ref: setViewport,
    autoScroll: isReaderAtBottom,
    scrollToBottomOnInitialize: !hasSavedPosition,
    scrollToBottomOnRunStart: isReaderAtBottom,
    scrollToBottomOnThreadSwitch: !hasSavedPosition,
    turnAnchor: "bottom",
  };
}
