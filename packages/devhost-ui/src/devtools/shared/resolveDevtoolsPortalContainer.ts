import { DEVTOOLS_ROOT_ID } from "./constants";

type DevtoolsTree = Document | ShadowRoot;

/**
 * Finds the devtools root (`DevtoolsTopLayer`) in the tree `anchorElement` is rendered in: the devtools shadow root
 * in production. Portaling anywhere else would leak devtools markup into the host page, so a missing root is an
 * error.
 */
export function resolveDevtoolsPortalContainer(anchorElement: HTMLElement): HTMLElement {
  const rootNode: Node = anchorElement.getRootNode();
  const tree: DevtoolsTree = rootNode instanceof ShadowRoot ? rootNode : anchorElement.ownerDocument;
  const devtoolsRoot: HTMLElement | null = tree.getElementById(DEVTOOLS_ROOT_ID);

  if (devtoolsRoot === null) {
    throw new Error("Devtools overlays must render in the same tree as the devtools root.");
  }

  return devtoolsRoot;
}
