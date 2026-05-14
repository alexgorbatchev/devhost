import { useEffect, type RefObject } from "react";

import {
  clearReactHighlightOverlays,
  createReactHighlightWebSocketUrl,
  highlightReactElements,
  isReactHighlightCursorMessage,
} from "../reactHighlightOverlay";
import { parseReactHighlightCursorPayload } from "../reactHighlightCursorPayload";

interface IUseReactHighlightOverlayParams {
  controlToken: string;
  enabled: boolean;
  overlayRootReference: RefObject<HTMLElement | null>;
  projectRootPath: string;
}

type ReactHighlightOverlayCleanup = () => void;

export function useReactHighlightOverlay({
  controlToken,
  enabled,
  overlayRootReference,
  projectRootPath,
}: IUseReactHighlightOverlayParams): void {
  useEffect((): ReactHighlightOverlayCleanup | undefined => {
    if (!enabled || controlToken.length === 0) {
      return undefined;
    }

    let overlays: Awaited<ReturnType<typeof highlightReactElements>> = [];
    let messageSequence: number = 0;
    let isDisposed: boolean = false;
    const websocket = new WebSocket(createReactHighlightWebSocketUrl(window.location, controlToken));

    websocket.addEventListener("message", (event: MessageEvent): void => {
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

      void highlightReactElements(payload.locator, payload.projectRoot || projectRootPath, overlayRoot).then(
        (nextOverlays: Awaited<ReturnType<typeof highlightReactElements>>): void => {
          if (isDisposed || currentMessageSequence !== messageSequence) {
            clearReactHighlightOverlays(nextOverlays);
            return;
          }

          clearReactHighlightOverlays(overlays);
          overlays = nextOverlays;
        },
      );
    });

    return () => {
      isDisposed = true;
      clearReactHighlightOverlays(overlays);
      websocket.close();
    };
  }, [controlToken, enabled, overlayRootReference, projectRootPath]);
}
