import { useEffect, type RefObject } from "react";

import {
  clearReactHighlightOverlays,
  createReactHighlightWebSocketUrl,
  highlightReactElements,
  isReactHighlightCursorMessage,
} from "../reactHighlightOverlay";
import { parseReactHighlightCursorPayload } from "../reactHighlightCursorPayload";
import { openReconnectingWebSocket } from "../../../shared/openReconnectingWebSocket";

interface IUseReactHighlightOverlayParams {
  enabled: boolean;
  highlightElements?: typeof highlightReactElements;
  overlayRootReference: RefObject<HTMLElement | null>;
  projectRootPath: string;
}

type ReactHighlightOverlayCleanup = () => void;

export function useReactHighlightOverlay({
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

    // Removes what is shown and makes a highlight that is still being resolved a stale one.
    const clearHighlight = (): void => {
      messageSequence += 1;
      clearReactHighlightOverlays(overlays);
      overlays = [];
    };

    const handleMessage = (event: MessageEvent): void => {
      const payload: unknown = parseReactHighlightCursorPayload(event.data);

      if (!isReactHighlightCursorMessage(payload)) {
        return;
      }

      clearHighlight();
      const currentMessageSequence: number = messageSequence;

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

    // The stream reports cursor moves and does not repeat the last one to a new connection, so the page cannot
    // tell where the cursor is while the stream is down. It shows nothing until the editor reports again.
    const stream = openReconnectingWebSocket(createReactHighlightWebSocketUrl(window.location), {
      onDisconnect: clearHighlight,
      onMessage: handleMessage,
    });

    return () => {
      isDisposed = true;
      clearReactHighlightOverlays(overlays);
      stream.close();
    };
  }, [enabled, highlightElements, overlayRootReference, projectRootPath]);
}
