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

interface IParsedReactHighlightLocator {
  column: number;
  fileName: string;
  line: number;
}

interface IReactHighlightSourceMap {
  sources: string[];
  sourcesContent: string[];
}

interface IReactHighlightSourceMapElementLocator {
  classNames: string[];
  occurrenceIndex: number;
  tagName: string;
}

const maximumFiberDepth: number = 50;
const sourceMapCache: Map<string, Promise<IReactHighlightSourceMap | undefined>> = new Map();

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

export async function highlightReactElements(locator: string, projectRootPath: string): Promise<IOverlayElement[]> {
  const matchingElements: HTMLElement[] = findReactHighlightElements(locator, projectRootPath);
  const effectiveMatchingElements: HTMLElement[] =
    matchingElements.length === 0
      ? await findReactHighlightElementsFromSourceMaps(locator, projectRootPath)
      : matchingElements;

  if (effectiveMatchingElements.length === 0) {
    console.warn(`[devhost][react-highlight] no DOM match for ${locator}`);
  }

  window.dispatchEvent(
    new CustomEvent("devhost:react-highlight", {
      detail: {
        locator,
        matchedCount: effectiveMatchingElements.length,
      },
    }),
  );

  return effectiveMatchingElements.map((element: HTMLElement): IOverlayElement => {
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

async function findReactHighlightElementsFromSourceMaps(
  locator: string,
  projectRootPath: string,
): Promise<HTMLElement[]> {
  const sourceMapElementLocator: IReactHighlightSourceMapElementLocator | undefined =
    await resolveReactHighlightSourceMapElementLocator(locator, projectRootPath);

  if (sourceMapElementLocator === undefined) {
    return [];
  }

  const candidates: HTMLElement[] = Array.from(
    document.body.getElementsByTagName(sourceMapElementLocator.tagName),
  ).filter((element: Element): element is HTMLElement => {
    return (
      element instanceof HTMLElement &&
      sourceMapElementLocator.classNames.every((className: string): boolean => element.classList.contains(className))
    );
  });
  const directMatch: HTMLElement | undefined = candidates[sourceMapElementLocator.occurrenceIndex];

  return directMatch === undefined ? [] : [directMatch];
}

export async function resolveReactHighlightSourceMapElementLocator(
  locator: string,
  projectRootPath: string,
): Promise<IReactHighlightSourceMapElementLocator | undefined> {
  const parsedLocator: IParsedReactHighlightLocator | undefined = parseReactHighlightLocator(locator);

  if (parsedLocator === undefined) {
    return undefined;
  }

  for (const sourceMap of await readReactHighlightSourceMaps()) {
    const sourceIndex: number = sourceMap.sources.findIndex((source: string): boolean => {
      return normalizeReactHighlightFileName(source, projectRootPath) === parsedLocator.fileName;
    });

    if (sourceIndex < 0) {
      continue;
    }

    const sourceContent: string | undefined = sourceMap.sourcesContent[sourceIndex];

    if (sourceContent === undefined) {
      continue;
    }

    const elementLocator: IReactHighlightSourceMapElementLocator | undefined = resolveSourceContentElementLocator(
      sourceContent,
      parsedLocator,
    );

    if (elementLocator !== undefined) {
      return elementLocator;
    }
  }

  return undefined;
}

function parseReactHighlightLocator(locator: string): IParsedReactHighlightLocator | undefined {
  const match: RegExpMatchArray | null = locator.match(/^(.+):(\d+):(\d+)$/);

  if (match === null) {
    return undefined;
  }

  const fileName: string | undefined = match[1];
  const lineText: string | undefined = match[2];
  const columnText: string | undefined = match[3];

  if (fileName === undefined || lineText === undefined || columnText === undefined) {
    return undefined;
  }

  return {
    column: Number.parseInt(columnText, 10),
    fileName,
    line: Number.parseInt(lineText, 10),
  };
}

function resolveSourceContentElementLocator(
  sourceContent: string,
  locator: IParsedReactHighlightLocator,
): IReactHighlightSourceMapElementLocator | undefined {
  const sourceLines: string[] = sourceContent.split(/\r?\n/);
  const sourceLine: string | undefined = sourceLines[locator.line - 1];

  if (sourceLine === undefined) {
    return undefined;
  }

  const columnIndex: number = Math.max(locator.column - 1, 0);
  const sourceLineFromColumn: string = sourceLine.slice(columnIndex);
  const tagMatch: RegExpMatchArray | null =
    sourceLineFromColumn.match(/<([a-z][a-z0-9-]*)(\s[^>]*)?/i) ?? sourceLine.match(/<([a-z][a-z0-9-]*)(\s[^>]*)?/i);

  if (tagMatch === null) {
    return undefined;
  }

  const tagName: string | undefined = tagMatch[1];
  const attributesText: string = tagMatch[2] ?? "";

  if (tagName === undefined || tagName[0] !== tagName[0]?.toLowerCase()) {
    return undefined;
  }

  return {
    classNames: readLiteralClassNames(attributesText),
    occurrenceIndex: countPreviousJsxTagOccurrences(sourceLines, locator, tagName),
    tagName,
  };
}

function readLiteralClassNames(attributesText: string): string[] {
  const classNameMatch: RegExpMatchArray | null = attributesText.match(/\bclassName=(["'])([^"']+)\1/);
  const rawClassNames: string | undefined = classNameMatch?.[2];

  return rawClassNames === undefined
    ? []
    : rawClassNames.split(/\s+/).filter((className: string): boolean => className.length > 0);
}

function countPreviousJsxTagOccurrences(
  sourceLines: string[],
  locator: IParsedReactHighlightLocator,
  tagName: string,
): number {
  const tagPattern: RegExp = new RegExp(`<${tagName}(?=\\s|>|/)`, "g");
  let occurrenceCount: number = 0;

  for (let lineIndex: number = 0; lineIndex < locator.line - 1; lineIndex += 1) {
    occurrenceCount += sourceLines[lineIndex]?.match(tagPattern)?.length ?? 0;
  }

  const locatorLine: string = sourceLines[locator.line - 1] ?? "";
  const textBeforeLocator: string = locatorLine.slice(0, Math.max(locator.column - 1, 0));

  return occurrenceCount + (textBeforeLocator.match(tagPattern)?.length ?? 0);
}

async function readReactHighlightSourceMaps(): Promise<IReactHighlightSourceMap[]> {
  const scriptElements: IScriptSourceElement[] = [];
  const sourceMaps: IReactHighlightSourceMap[] = [];

  for (const element of Array.from(document.querySelectorAll("script[src]"))) {
    if (isScriptSourceElement(element)) {
      scriptElements.push(element);
    }
  }

  for (const scriptElement of scriptElements) {
    const scriptUrl: string = scriptElement.src;
    let sourceMapPromise: Promise<IReactHighlightSourceMap | undefined> | undefined = sourceMapCache.get(scriptUrl);

    if (sourceMapPromise === undefined) {
      sourceMapPromise = fetchReactHighlightSourceMap(scriptUrl);
      sourceMapCache.set(scriptUrl, sourceMapPromise);
    }

    const sourceMap: IReactHighlightSourceMap | undefined = await sourceMapPromise;

    if (sourceMap !== undefined) {
      sourceMaps.push(sourceMap);
    }
  }

  return sourceMaps;
}

interface IScriptSourceElement {
  src: string;
}

function isScriptSourceElement(value: unknown): value is IScriptSourceElement {
  return typeof value === "object" && value !== null && typeof Reflect.get(value, "src") === "string";
}

async function fetchReactHighlightSourceMap(scriptUrl: string): Promise<IReactHighlightSourceMap | undefined> {
  try {
    const scriptResponse: Response = await fetch(scriptUrl);

    if (!scriptResponse.ok) {
      return undefined;
    }

    const sourceMapUrl: string | undefined = resolveSourceMapUrl(await scriptResponse.text(), scriptUrl);

    if (sourceMapUrl === undefined) {
      return undefined;
    }

    const sourceMapResponse: Response = await fetch(sourceMapUrl);

    if (!sourceMapResponse.ok) {
      return undefined;
    }

    return parseReactHighlightSourceMap(await sourceMapResponse.json());
  } catch {
    return undefined;
  }
}

function resolveSourceMapUrl(scriptText: string, scriptUrl: string): string | undefined {
  const match: RegExpMatchArray | null = scriptText.match(/\/\/# sourceMappingURL=(\S+)\s*$/);
  const rawSourceMapUrl: string | undefined = match?.[1];

  return rawSourceMapUrl === undefined ? undefined : new URL(rawSourceMapUrl, scriptUrl).toString();
}

function parseReactHighlightSourceMap(value: unknown): IReactHighlightSourceMap | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const sources: unknown = Reflect.get(value, "sources");
  const sourcesContent: unknown = Reflect.get(value, "sourcesContent");

  if (!Array.isArray(sources) || !Array.isArray(sourcesContent)) {
    return undefined;
  }

  if (
    !sources.every((source: unknown): source is string => typeof source === "string") ||
    !sourcesContent.every((sourceContent: unknown): sourceContent is string => typeof sourceContent === "string")
  ) {
    return undefined;
  }

  return {
    sources,
    sourcesContent,
  };
}
