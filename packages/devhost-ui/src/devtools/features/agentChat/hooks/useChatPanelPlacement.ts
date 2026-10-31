import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import { z } from "zod";
import { pristineFetch } from "../../../shared/pristineFetch";
import { clampChatPanelPosition } from "../clampChatPanelPosition";
import type { IChatPanelPosition, IChatPanelSize } from "../types";

const CHAT_PANEL_PATH = "/__devhost__/chat/panel";
const KEYBOARD_STEP = 16;
/** Tailwind's `sm` breakpoint, below which chat keeps its docked phone layout. */
const DOCKED_QUERY = "(max-width: 639px)";
const IGNORED_DRAG_TARGET = "button, a, input, select, textarea, [role='combobox'], [role='group']";
const layoutSchema = z.object({ position: z.object({ left: z.number(), top: z.number() }).nullable() });

interface IChatPanelPlacementOptions {
  isOpen: boolean;
}

interface IChatPanelPlacement {
  panelReference: RefObject<HTMLElement | null>;
  headerReference: RefObject<HTMLElement | null>;
  /** The dragged position as inline geometry, undefined while the panel sits at its dock. */
  panelStyle: CSSProperties | undefined;
  isMoved: boolean;
  canMove: boolean;
  onHeaderPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onHandleKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  resetPosition: VoidFunction;
}

function readViewport(): IChatPanelSize {
  return { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight };
}

function savePosition(position: IChatPanelPosition | null): void {
  void pristineFetch(CHAT_PANEL_PATH, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ position }),
  }).catch(() => {
    // The panel stays where it was put for this page; only the next page load loses it.
  });
}

/** Moves the chat panel by its header or by keyboard, and keeps it reachable as the viewport changes. */
export function useChatPanelPlacement({ isOpen }: IChatPanelPlacementOptions): IChatPanelPlacement {
  const panelReference = useRef<HTMLElement | null>(null);
  const headerReference = useRef<HTMLElement | null>(null);
  const [position, setPosition] = useState<IChatPanelPosition | null>(null);
  const [viewport, setViewport] = useState<IChatPanelSize>(readViewport);
  const [isDocked, setIsDocked] = useState<boolean>(() => window.matchMedia(DOCKED_QUERY).matches);
  useEffect(() => {
    const lifetime = new AbortController();
    pristineFetch(CHAT_PANEL_PATH, { signal: lifetime.signal })
      .then(async (response) => (response.ok ? layoutSchema.parse(await response.json()).position : null))
      .then(setPosition, () => {
        // Without a saved position chat opens at its dock.
      });
    return () => lifetime.abort();
  }, []);
  useEffect(() => {
    const docked = window.matchMedia(DOCKED_QUERY);
    const update = (): void => {
      setViewport(readViewport());
      setIsDocked(docked.matches);
    };
    update();
    window.addEventListener("resize", update);
    docked.addEventListener("change", update);
    return () => {
      window.removeEventListener("resize", update);
      docked.removeEventListener("change", update);
    };
  }, [isOpen]);
  const clamp = useCallback(
    (next: IChatPanelPosition): IChatPanelPosition => {
      const panel = panelReference.current?.getBoundingClientRect();
      const header = headerReference.current?.getBoundingClientRect();
      const size = { width: panel?.width ?? 0, height: panel && header ? Math.ceil(header.bottom - panel.top) : 0 };
      return clampChatPanelPosition(next, size, viewport);
    },
    [viewport],
  );
  const move = useCallback(
    (next: IChatPanelPosition): void => {
      const clamped = clamp(next);
      setPosition(clamped);
      savePosition(clamped);
    },
    [clamp],
  );
  const resetPosition = useCallback((): void => {
    setPosition(null);
    savePosition(null);
  }, []);
  const onHeaderPointerDown = useCallback(
    (event: PointerEvent<HTMLElement>): void => {
      const panel = panelReference.current;
      if (isDocked || panel === null || event.button !== 0) return;
      const { currentTarget: header, target } = event;
      // Dialogs opened from the header portal elsewhere, but their events still bubble here through React.
      if (!(target instanceof Element) || !header.contains(target)) return;
      if (target.closest(IGNORED_DRAG_TARGET) !== null) return;
      event.preventDefault();
      const { left, top } = panel.getBoundingClientRect();
      const offset = { left: event.clientX - left, top: event.clientY - top };
      header.setPointerCapture(event.pointerId);
      let latest: IChatPanelPosition = { left, top };
      const follow = (pointer: globalThis.PointerEvent): void => {
        latest = clamp({ left: pointer.clientX - offset.left, top: pointer.clientY - offset.top });
        setPosition(latest);
      };
      const finish = (): void => {
        header.removeEventListener("pointermove", follow);
        header.removeEventListener("pointerup", finish);
        header.removeEventListener("pointercancel", finish);
        savePosition(latest);
      };
      header.addEventListener("pointermove", follow);
      header.addEventListener("pointerup", finish);
      header.addEventListener("pointercancel", finish);
    },
    [clamp, isDocked],
  );
  const onHandleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>): void => {
      const panel = panelReference.current;
      if (panel === null) return;
      if (event.key === "Home") {
        event.preventDefault();
        resetPosition();
        return;
      }
      const steps: Readonly<Record<string, IChatPanelPosition>> = {
        ArrowLeft: { left: -KEYBOARD_STEP, top: 0 },
        ArrowRight: { left: KEYBOARD_STEP, top: 0 },
        ArrowUp: { left: 0, top: -KEYBOARD_STEP },
        ArrowDown: { left: 0, top: KEYBOARD_STEP },
      };
      const step = steps[event.key];
      if (step === undefined) return;
      event.preventDefault();
      const { left, top } = panel.getBoundingClientRect();
      move({ left: left + step.left, top: top + step.top });
    },
    [move, resetPosition],
  );
  const visible = position === null || isDocked ? null : clamp(position);
  return {
    panelReference,
    headerReference,
    panelStyle: visible === null ? undefined : { ...visible, right: "auto", bottom: "auto", margin: 0 },
    isMoved: visible !== null,
    canMove: !isDocked,
    onHeaderPointerDown,
    onHandleKeyDown,
    resetPosition,
  };
}
