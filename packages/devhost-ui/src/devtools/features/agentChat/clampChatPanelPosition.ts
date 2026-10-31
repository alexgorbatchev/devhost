import type { IChatPanelPosition, IChatPanelSize } from "./types";

/**
 * Keeps a dragged panel reachable in the current viewport. The whole width stays on screen, and the height only as far
 * as the header needs, because expanded chat is often taller than the space below where it was dragged to.
 */
export function clampChatPanelPosition(
  position: IChatPanelPosition,
  panel: IChatPanelSize,
  viewport: IChatPanelSize,
): IChatPanelPosition {
  return {
    left: Math.min(Math.max(0, position.left), Math.max(0, viewport.width - panel.width)),
    top: Math.min(Math.max(0, position.top), Math.max(0, viewport.height - panel.height)),
  };
}
