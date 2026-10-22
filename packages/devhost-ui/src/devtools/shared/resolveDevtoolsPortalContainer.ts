import { ANNOTATION_LAYER_SELECTOR, DEVTOOLS_ROOT_ID } from "./constants";

type DevtoolsTree = Document | ShadowRoot;

/**
 * Uses the enclosing annotation layer when present; otherwise finds DevtoolsTopLayer in the anchor's tree.
 * Both stay in an isolated devtools tree, including when the annotation mount follows a host modal or popover.
 */
export function resolveDevtoolsPortalContainer(anchorElement: HTMLElement): HTMLElement {
  const annotationLayer = anchorElement.closest<HTMLElement>(ANNOTATION_LAYER_SELECTOR);
  if (annotationLayer !== null) return annotationLayer;
  const rootNode: Node = anchorElement.getRootNode();
  const tree: DevtoolsTree = rootNode instanceof ShadowRoot ? rootNode : anchorElement.ownerDocument;
  const devtoolsRoot: HTMLElement | null = tree.getElementById(DEVTOOLS_ROOT_ID);

  if (devtoolsRoot === null) {
    throw new Error("Devtools overlays must render in the same tree as the devtools root.");
  }

  return devtoolsRoot;
}
