import { promoteDevtoolsTopLayer } from "./promoteDevtoolsTopLayer";
import type { AnnotationLayerPlacement } from "./types";

export interface IAnnotationTopLayerOrder {
  /** The DevtoolsTopLayer root the layer belongs to. */
  home: HTMLElement;
  layer: HTMLElement;
  placement: AnnotationLayerPlacement;
  /** The annotation layer that paints above this one: chat and the annotation tools. */
  cover: HTMLElement | null;
}

/**
 * Re-enters an annotation layer above the host's top-layer elements. A layer that belongs below the ordinary
 * devtools surfaces then puts the devtools root, and the layer that covers it, back above itself.
 */
export function promoteAnnotationTopLayer(order: IAnnotationTopLayerOrder): void {
  promoteDevtoolsTopLayer(order.layer);
  restackAboveAnnotationTopLayer(order);
}

/** Returns the devtools root and the covering layer above a layer that has just entered the top layer. */
export function restackAboveAnnotationTopLayer({ home, placement, cover }: IAnnotationTopLayerOrder): void {
  if (placement !== "below-devtools") return;
  promoteDevtoolsTopLayer(home);
  // The root re-enters the covering layer when it holds it, but not when a devtools popover keeps the root in place.
  if (cover !== null) promoteDevtoolsTopLayer(cover);
}
