import { DEVTOOLS_ROOT_ATTRIBUTE_NAME, DEVTOOLS_ROOT_ID } from "./constants";

export function resolveDevtoolsPortalContainer(anchorElement: HTMLElement): HTMLElement {
  const rootNode: Node = anchorElement.getRootNode();

  if (rootNode instanceof ShadowRoot) {
    const shadowAppRoot: HTMLElement | null = rootNode.querySelector<HTMLElement>(`#${DEVTOOLS_ROOT_ID}`);

    if (shadowAppRoot !== null) {
      return shadowAppRoot;
    }

    const shadowRootFallback: HTMLElement | null = rootNode.querySelector<HTMLElement>(
      `[${DEVTOOLS_ROOT_ATTRIBUTE_NAME}]`,
    );

    if (shadowRootFallback !== null) {
      return shadowRootFallback;
    }
  }

  const documentAppRoot: HTMLElement | null = anchorElement.ownerDocument.getElementById(DEVTOOLS_ROOT_ID);

  if (documentAppRoot !== null) {
    return documentAppRoot;
  }

  const documentBody: HTMLElement | null = anchorElement.ownerDocument.body;

  if (documentBody !== null) {
    return documentBody;
  }

  return anchorElement;
}
