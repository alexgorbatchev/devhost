import { useEffect, type RefObject } from "react";

import {
  clearReactHighlightOverlays,
  createReactHighlightWebSocketUrl,
  highlightReactElements,
  isReactHighlightCursorMessage,
} from "../reactHighlightOverlay";
import { parseReactHighlightCursorPayload } from "../reactHighlightCursorPayload";
import { pristineWebSocket } from "../../../shared/pristineFetch";

interface IUseReactHighlightOverlayParams {
  createWebSocket?: (url: string) => Pick<WebSocket, "addEventListener" | "removeEventListener" | "close">;
  enabled: boolean;
  highlightElements?: typeof highlightReactElements;
  overlayRootReference: RefObject<HTMLElement | null>;
  projectRootPath: string;
}

type ReactHighlightOverlayCleanup = () => void;

export function useReactHighlightOverlay({
  createWebSocket = openReactHighlightWebSocket,
  enabled,
  highlightElements = highlightReactElements,
  overlayRootReference,
  projectRootPath,
}: IUseReactHighlightOverlayParams): void {
  useEffect((): ReactHighlightOverlayCleanup | undefined => {
    if (!enabled) {
      return undefined;
    }

    let overlays: Awaited<ReturnType<typeof highlightReactElements>> = [];
    let messageSequence: number = 0;
    let isDisposed: boolean = false;
    const websocket = createWebSocket(createReactHighlightWebSocketUrl(window.location));

    const handleMessage = (event: MessageEvent): void => {
      const payload: unknown = parseReactHighlightCursorPayload(event.data);

      if (!isReactHighlightCursorMessage(payload)) {
        return;
      }

      messageSequence += 1;
      const currentMessageSequence: number = messageSequence;
      clearReactHighlightOverlays(overlays);
      overlays = [];

      if (payload.locator === null) {
        return;
      }

      const overlayRoot: HTMLElement | null = overlayRootReference.current;

      if (overlayRoot === null) {
        return;
      }

      void highlightElements(payload.locator, payload.projectRoot || projectRootPath, overlayRoot).then(
        (nextOverlays: Awaited<ReturnType<typeof highlightReactElements>>): void => {
          if (isDisposed || currentMessageSequence !== messageSequence) {
            clearReactHighlightOverlays(nextOverlays);
            return;
          }

          clearReactHighlightOverlays(overlays);
          overlays = nextOverlays;
        },
      );
    };

    websocket.addEventListener("message", handleMessage);

    return () => {
      isDisposed = true;
      websocket.removeEventListener("message", handleMessage);
      clearReactHighlightOverlays(overlays);
      websocket.close();
    };
  }, [createWebSocket, enabled, highlightElements, overlayRootReference, projectRootPath]);
}

function openReactHighlightWebSocket(url: string): WebSocket {
  return pristineWebSocket(url);
}
