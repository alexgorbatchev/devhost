import { TOP_LAYER_ELEMENT_SELECTOR } from "./constants";

/**
 * Moves the devtools top-layer root above every other element in the browser's top layer.
 *
 * Top-layer elements paint in the order they entered and z-index cannot reorder them, so the root re-enters.
 * Hiding and showing it within one task never renders the closed state: focus, scroll offsets, and transitions
 * inside the root are unaffected.
 *
 * Devtools popovers and dialogs opened from inside the root must stay above it and keep their anchors, so the root
 * stays where it is until they close. Elements that are not an open devtools top-layer root are left alone.
 */
export function promoteDevtoolsTopLayer(topLayerElement: HTMLElement): void {
  if (!topLayerElement.matches(":popover-open") || topLayerElement.querySelector(TOP_LAYER_ELEMENT_SELECTOR) !== null) {
    return;
  }

  topLayerElement.hidePopover();
  topLayerElement.showPopover();
}
