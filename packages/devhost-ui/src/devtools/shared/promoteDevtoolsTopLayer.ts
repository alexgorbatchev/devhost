import {
  ANNOTATION_LAYER_SELECTOR,
  BELOW_DEVTOOLS_ANNOTATION_LAYER_SELECTOR,
  TOP_LAYER_ELEMENT_SELECTOR,
} from "./constants";

/**
 * Moves the devtools top-layer root above every other element in the browser's top layer.
 *
 * Top-layer elements paint in the order they entered and z-index cannot reorder them, so the root re-enters.
 * Hiding and showing it within one task never renders the closed state: focus, scroll offsets, and transitions
 * inside the root are unaffected.
 *
 * Devtools popovers and dialogs opened from inside the root must stay above it and keep their anchors, so the root
 * stays where it is until they close and any popover exit transition finishes. Annotation layers mounted inside the
 * root order themselves: the ones that belong above it re-enter right after it in the same task, and a layer that
 * belongs below it stays where it is. Elements that are not an open devtools top-layer root are left alone.
 */
export function promoteDevtoolsTopLayer(topLayerElement: HTMLElement): void {
  if (!topLayerElement.matches(":popover-open") || hasHeldTopLayerElement(topLayerElement)) {
    return;
  }

  topLayerElement.hidePopover();
  topLayerElement.showPopover();

  for (const layer of topLayerElement.querySelectorAll<HTMLElement>(ANNOTATION_LAYER_SELECTOR)) {
    if (layer.matches(":popover-open") && !layer.matches(BELOW_DEVTOOLS_ANNOTATION_LAYER_SELECTOR)) {
      layer.hidePopover();
      layer.showPopover();
    }
  }
}

function hasHeldTopLayerElement(topLayerElement: HTMLElement): boolean {
  for (const element of topLayerElement.querySelectorAll(TOP_LAYER_ELEMENT_SELECTOR)) {
    if (!element.matches(ANNOTATION_LAYER_SELECTOR)) {
      return true;
    }
  }

  // A closed popover remains in the top layer while its overlay exit transition runs. Moving its trigger above
  // it during that interval invalidates the anchor and sends the fading panel to the viewport origin.
  for (const popoverElement of topLayerElement.querySelectorAll("[popover]")) {
    if (
      !popoverElement.matches(ANNOTATION_LAYER_SELECTOR) &&
      getComputedStyle(popoverElement).getPropertyValue("overlay") === "auto"
    ) {
      return true;
    }
  }

  return false;
}
