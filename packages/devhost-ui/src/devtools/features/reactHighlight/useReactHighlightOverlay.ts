import { useEffect } from "react";

import {
  clearReactHighlightOverlays,
  createReactHighlightWebSocketUrl,
  highlightReactElements,
  isReactHighlightCursorMessage,
} from "./reactHighlightOverlay";
import { parseReactHighlightCursorPayload } from "./reactHighlightCursorPayload";

interface IUseReactHighlightOverlayParams {
  controlToken: string;
  enabled: boolean;
  projectRootPath: string;
}

type ReactHighlightOverlayCleanup = () => void;

export function useReactHighlightOverlay({
  controlToken,
  enabled,
  projectRootPath,
}: IUseReactHighlightOverlayParams): void {
  useEffect((): ReactHighlightOverlayCleanup | undefined => {
    if (!enabled || controlToken.length === 0) {
      return undefined;
    }

    let overlays: ReturnType<typeof highlightReactElements> = [];
    const websocket = new WebSocket(createReactHighlightWebSocketUrl(window.location, controlToken));

    websocket.addEventListener("message", (event: MessageEvent): void => {
      const payload: unknown = parseReactHighlightCursorPayload(event.data);

      if (!isReactHighlightCursorMessage(payload)) {
        return;
      }

      clearReactHighlightOverlays(overlays);
      overlays =
        payload.locator === null ? [] : highlightReactElements(payload.locator, payload.projectRoot || projectRootPath);
    });

    return () => {
      clearReactHighlightOverlays(overlays);
      websocket.close();
    };
  }, [controlToken, enabled, projectRootPath]);
}
