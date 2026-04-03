import { DEVTOOLS_ROOT_ATTRIBUTE_NAME, DEVTOOLS_ROOT_ID } from "../../shared/constants";

const GENERIC_CONTAINER_TAGS: ReadonlySet<string> = new Set([
  "DIV",
  "SPAN",
  "SECTION",
  "ARTICLE",
  "MAIN",
  "ASIDE",
  "HEADER",
  "FOOTER",
  "NAV",
]);

export function resolveAnnotationTarget(clientX: number, clientY: number): HTMLElement | null {
  const candidateElements: HTMLElement[] = document
    .elementsFromPoint(clientX, clientY)
    .filter((element: Element): element is HTMLElement => {
      return element instanceof HTMLElement;
    });

  if (candidateElements.length === 0) {
    return null;
  }

  let smallestCandidate: HTMLElement | null = null;
  let smallestArea: number = Number.POSITIVE_INFINITY;

  for (const candidateElement of candidateElements) {
    if (isSkippableCandidate(candidateElement)) {
      continue;
    }

    const piercedElement: HTMLElement = pierceShadowDom(candidateElement, clientX, clientY);

    if (isSkippableCandidate(piercedElement) || isEffectivelyInvisible(piercedElement)) {
      continue;
    }

    if (hasDirectContent(piercedElement)) {
      return piercedElement;
    }

    const candidateRectangle: DOMRect = piercedElement.getBoundingClientRect();
    const candidateArea: number = candidateRectangle.width * candidateRectangle.height;

    if (candidateArea > 0 && candidateArea < smallestArea) {
      smallestCandidate = piercedElement;
      smallestArea = candidateArea;
    }
  }

  return smallestCandidate;
}

function pierceShadowDom(element: HTMLElement, clientX: number, clientY: number): HTMLElement {
  let currentElement: HTMLElement = element;

  while (currentElement.shadowRoot !== null) {
    const deeperElement: Element | null = currentElement.shadowRoot.elementFromPoint(clientX, clientY);

    if (!(deeperElement instanceof HTMLElement) || deeperElement === currentElement) {
      break;
    }

    currentElement = deeperElement;
  }

  return currentElement;
}

function hasDirectContent(element: HTMLElement): boolean {
  if (!GENERIC_CONTAINER_TAGS.has(element.tagName)) {
    return true;
  }

  for (const childNode of element.childNodes) {
    if (childNode.nodeType !== Node.TEXT_NODE) {
      continue;
    }

    const textContent: string = childNode.textContent?.trim() ?? "";

    if (textContent.length > 0) {
      return true;
    }
  }

  return false;
}

function isEffectivelyInvisible(element: HTMLElement): boolean {
  if (typeof element.checkVisibility === "function") {
    return !element.checkVisibility({
      checkOpacity: true,
      checkVisibilityCSS: true,
    });
  }

  let currentElement: HTMLElement | null = element;

  while (currentElement !== null && currentElement !== document.body) {
    const computedStyle: CSSStyleDeclaration = window.getComputedStyle(currentElement);

    if (computedStyle.opacity === "0" || computedStyle.visibility === "hidden") {
      return true;
    }

    currentElement = currentElement.parentElement;
  }

  return false;
}

function isSkippableCandidate(element: HTMLElement): boolean {
  if (element === document.body || element === document.documentElement) {
    return true;
  }

  if (element.id === DEVTOOLS_ROOT_ID) {
    return true;
  }

  return element.closest(`[${DEVTOOLS_ROOT_ATTRIBUTE_NAME}], #${DEVTOOLS_ROOT_ID}`) !== null;
}
