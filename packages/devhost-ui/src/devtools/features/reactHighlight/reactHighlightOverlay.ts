import {
  getFiberFromElement,
  readDirectSource,
  readOwnerFiber,
  readParentFiber,
  type IReactFiberNode,
} from "../../shared/reactSourceInspection";
import { cleanSourcePath, type ISourceLocation } from "../../shared/sourceLocation";
import { DEVTOOLS_CONTROL_TOKEN_QUERY_PARAMETER_NAME, REACT_HIGHLIGHT_WEBSOCKET_PATH } from "../../shared/constants";

export interface IReactHighlightCursorMessage {
  kind: "cursor";
  locator: string | null;
  projectRoot: string;
  stackName: string;
  timestamp: number;
}

export interface IOverlayElement {
  overlay: HTMLDivElement;
}

const maximumFiberDepth: number = 50;

export function createReactHighlightWebSocketUrl(location: Location, controlToken: string): string {
  const protocol: string = location.protocol === "https:" ? "wss:" : "ws:";
  const url = new URL(REACT_HIGHLIGHT_WEBSOCKET_PATH, `${protocol}//${location.host}`);
  url.searchParams.set(DEVTOOLS_CONTROL_TOKEN_QUERY_PARAMETER_NAME, controlToken);
  return url.toString();
}

export function isReactHighlightCursorMessage(value: unknown): value is IReactHighlightCursorMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const kind: unknown = Reflect.get(value, "kind");
  const locator: unknown = Reflect.get(value, "locator");
  const projectRoot: unknown = Reflect.get(value, "projectRoot");
  const stackName: unknown = Reflect.get(value, "stackName");
  const timestamp: unknown = Reflect.get(value, "timestamp");

  return (
    kind === "cursor" &&
    (typeof locator === "string" || locator === null) &&
    typeof projectRoot === "string" &&
    typeof stackName === "string" &&
    typeof timestamp === "number"
  );
}

export function findReactHighlightElements(locator: string, projectRootPath: string): HTMLElement[] {
  const directMatches: HTMLElement[] = [];
  const fallbackMatches: HTMLElement[] = [];
  const stack: HTMLElement[] = document.body instanceof HTMLElement ? [document.body] : [];

  while (stack.length > 0) {
    const currentElement: HTMLElement | undefined = stack.pop();

    if (currentElement === undefined) {
      continue;
    }

    const locators: string[] = readReactHighlightLocatorsForElement(currentElement, projectRootPath);
    const firstLocator: string | undefined = locators[0];
    const isDirectMatch: boolean = firstLocator === locator;
    const isFallbackMatch: boolean = !isDirectMatch && locators.includes(locator);

    if (isDirectMatch) {
      directMatches.push(currentElement);
      continue;
    }

    if (isFallbackMatch) {
      fallbackMatches.push(currentElement);
      continue;
    }

    for (let index = currentElement.children.length - 1; index >= 0; index -= 1) {
      const childElement: Element | null = currentElement.children.item(index);

      if (childElement instanceof HTMLElement) {
        stack.push(childElement);
      }
    }
  }

  return directMatches.length > 0 ? directMatches : fallbackMatches;
}

export function readReactHighlightLocatorsForElement(element: HTMLElement, projectRootPath: string): string[] {
  const fiber: IReactFiberNode | null = getFiberFromElement(element);

  if (fiber === null) {
    return [];
  }

  const locators: string[] = [];
  const seenLocators: Set<string> = new Set<string>();
  let currentFiber: IReactFiberNode | null = fiber;
  let depth: number = 0;

  while (currentFiber !== null && depth < maximumFiberDepth) {
    addSourceLocator(locators, seenLocators, readDirectSource(currentFiber), projectRootPath);

    const ownerFiber: IReactFiberNode | null = readOwnerFiber(currentFiber);
    if (ownerFiber !== null) {
      addSourceLocator(locators, seenLocators, readDirectSource(ownerFiber), projectRootPath);
    }

    currentFiber = readParentFiber(currentFiber);
    depth += 1;
  }

  return locators;
}

export function highlightReactElements(locator: string, projectRootPath: string): IOverlayElement[] {
  const matchingElements: HTMLElement[] = findReactHighlightElements(locator, projectRootPath);
  return matchingElements.map((element: HTMLElement): IOverlayElement => {
    const rect: DOMRect = element.getBoundingClientRect();
    const overlay: HTMLDivElement = document.createElement("div");
    overlay.setAttribute("data-devhost-react-highlight-overlay", "");
    overlay.style.position = "fixed";
    overlay.style.left = `${rect.left}px`;
    overlay.style.top = `${rect.top}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
    overlay.style.border = "2px solid rgba(32, 144, 255, 0.9)";
    overlay.style.borderRadius = "4px";
    overlay.style.boxSizing = "border-box";
    overlay.style.pointerEvents = "none";
    overlay.style.zIndex = "2147483647";
    document.body.appendChild(overlay);

    return { overlay };
  });
}

export function clearReactHighlightOverlays(overlays: IOverlayElement[]): void {
  overlays.forEach((overlayElement: IOverlayElement): void => {
    overlayElement.overlay.remove();
  });
}

function addSourceLocator(
  locators: string[],
  seenLocators: Set<string>,
  sourceLocation: ISourceLocation | null,
  projectRootPath: string,
): void {
  if (sourceLocation === null) {
    return;
  }

  const fileName: string = normalizeReactHighlightFileName(sourceLocation.fileName, projectRootPath);
  const columnNumber: number = sourceLocation.columnNumber ?? 1;
  const locator: string = `${fileName}:${sourceLocation.lineNumber}:${columnNumber}`;

  if (seenLocators.has(locator)) {
    return;
  }

  seenLocators.add(locator);
  locators.push(locator);
}

function normalizeReactHighlightFileName(rawFileName: string, projectRootPath: string): string {
  const cleanedPath: string = cleanSourcePath(rawFileName).replace(/\\/g, "/");
  const normalizedProjectRootPath: string = projectRootPath.replace(/\\/g, "/").replace(/\/+$/, "");

  if (normalizedProjectRootPath.length === 0) {
    return cleanedPath;
  }

  if (cleanedPath === normalizedProjectRootPath) {
    return "";
  }

  const projectRootPrefix: string = `${normalizedProjectRootPath}/`;

  return cleanedPath.startsWith(projectRootPrefix) ? cleanedPath.slice(projectRootPrefix.length) : cleanedPath;
}
