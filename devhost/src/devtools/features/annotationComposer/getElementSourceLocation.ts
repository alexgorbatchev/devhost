import { symbolicateSourceLocation } from "./symbolicateSourceLocation";
import type { IAnnotationSourceLocation } from "./types";

interface IReactFiberNode {
  _debugOwner?: IReactFiberNode | null;
  return?: IReactFiberNode | null;
  memoizedProps?: Record<string, unknown>;
  type?: unknown;
}

type IReactFunctionLocationTuple = [string, string, number, number];
type IReactStackFrameTuple = [string, string, number, number, number, number, boolean];

interface IDevToolsInspectElementPayload {
  type?: string;
  value?: {
    source?: IReactFunctionLocationTuple | IStandardSourceShape | null;
    stack?: IReactStackFrameTuple[] | null;
  };
}

interface IReactDevToolsHook {
  rendererInterfaces?: Map<unknown, IReactDevToolsRendererInterface>;
  renderers?: Map<unknown, IReactRenderer>;
}

interface IReactDevToolsRendererInterface {
  getDisplayNameForElementID: (id: number) => string | null;
  getElementIDForHostInstance: (element: HTMLElement) => number | null;
  inspectElement: (
    requestId: number,
    id: number,
    inspectedPath: Array<string | number> | null,
    forceFullData: boolean,
  ) => IDevToolsInspectElementPayload;
}

interface IReactRenderer {
  findFiberByHostInstance: (element: HTMLElement) => IReactFiberNode | null;
}

interface IStandardSourceShape {
  columnNumber?: number;
  fileName: string;
  lineNumber: number;
}

const maximumFiberDepth: number = 50;

export async function getElementSourceLocation(
  element: HTMLElement,
): Promise<IAnnotationSourceLocation | undefined> {
  const rawSourceLocation: IAnnotationSourceLocation | undefined =
    getSourceLocationFromRendererInterface(element) ?? getSourceLocationFromFiber(element);

  if (rawSourceLocation === undefined) {
    return undefined;
  }

  const symbolicatedSourceLocation: IAnnotationSourceLocation | undefined = await symbolicateSourceLocation(
    rawSourceLocation,
  );

  return normalizeSourceLocation(symbolicatedSourceLocation ?? rawSourceLocation);
}

function normalizeSourceLocation(sourceLocation: IAnnotationSourceLocation): IAnnotationSourceLocation {
  return {
    columnNumber: sourceLocation.columnNumber,
    componentName: sourceLocation.componentName,
    fileName: cleanSourcePath(sourceLocation.fileName),
    lineNumber: sourceLocation.lineNumber,
  };
}

function createSourceLocation(
  fiber: IReactFiberNode,
  source: IStandardSourceShape,
): IAnnotationSourceLocation {
  return {
    columnNumber: source.columnNumber,
    componentName: readComponentName(fiber),
    fileName: source.fileName,
    lineNumber: source.lineNumber,
  };
}

function cleanSourcePath(rawPath: string): string {
  return rawPath
    .replace(/[?#].*$/, "")
    .replace(/^turbopack:\/\/\/\[project\]\//, "")
    .replace(/^webpack-internal:\/\/\/\.\//, "")
    .replace(/^webpack-internal:\/\/\//, "")
    .replace(/^webpack:\/\/\/\.\//, "")
    .replace(/^webpack:\/\/\//, "")
    .replace(/^turbopack:\/\/\//, "")
    .replace(/^https?:\/\/[^/]+\//, "")
    .replace(/^file:\/\/\//, "/")
    .replace(/^\([^)]+\)\/\.\//, "")
    .replace(/^\.\//, "");
}

function getSourceLocationFromFiber(element: HTMLElement): IAnnotationSourceLocation | undefined {
  let currentFiber: IReactFiberNode | null = getFiberFromElement(element);
  let depth: number = 0;

  while (currentFiber !== null && depth < maximumFiberDepth) {
    const directSource: IStandardSourceShape | null = readDirectSource(currentFiber);

    if (directSource !== null) {
      return createSourceLocation(currentFiber, directSource);
    }

    const ownerFiber: IReactFiberNode | null = readOwnerFiber(currentFiber);

    if (ownerFiber !== null) {
      const ownerSource: IStandardSourceShape | null = readDirectSource(ownerFiber);

      if (ownerSource !== null) {
        return createSourceLocation(ownerFiber, ownerSource);
      }
    }

    currentFiber = readParentFiber(currentFiber);
    depth += 1;
  }

  return undefined;
}

function getFiberFromDevTools(element: HTMLElement): IReactFiberNode | null {
  if (typeof window !== "object") {
    return null;
  }

  const hook: IReactDevToolsHook | null = readReactDevToolsHook();

  if (hook === null) {
    return null;
  }

  const renderers: unknown = hook.renderers;

  if (!(renderers instanceof Map)) {
    return null;
  }

  for (const renderer of renderers.values()) {
    if (!isReactRenderer(renderer)) {
      continue;
    }

    try {
      const fiber: IReactFiberNode | null = renderer.findFiberByHostInstance(element);

      if (isReactFiberNode(fiber)) {
        return fiber;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function getFiberFromElement(element: HTMLElement): IReactFiberNode | null {
  const fiberFromDevTools: IReactFiberNode | null = getFiberFromDevTools(element);

  if (fiberFromDevTools !== null) {
    return fiberFromDevTools;
  }

  const reactPropertyKeys: string[] = Object.keys(element).filter((key: string): boolean => {
    return (
      key.startsWith("__reactFiber$") ||
      key.startsWith("__reactInternalInstance$") ||
      key.startsWith("__react")
    );
  });

  for (const key of reactPropertyKeys) {
    const candidateFiber: unknown = Reflect.get(element, key);

    if (isReactFiberNode(candidateFiber)) {
      return candidateFiber;
    }
  }

  return null;
}

function getSourceLocationFromRendererInterface(
  element: HTMLElement,
): IAnnotationSourceLocation | undefined {
  if (typeof window !== "object") {
    return undefined;
  }

  const hook: IReactDevToolsHook | null = readReactDevToolsHook();
  const rendererInterfaces: unknown = hook?.rendererInterfaces;

  if (!(rendererInterfaces instanceof Map)) {
    return undefined;
  }

  for (const rendererInterface of rendererInterfaces.values()) {
    if (!isReactDevToolsRendererInterface(rendererInterface)) {
      continue;
    }

    try {
      const elementId: number | null = rendererInterface.getElementIDForHostInstance(element);

      if (elementId === null) {
        continue;
      }

      const inspectedElement: IDevToolsInspectElementPayload = rendererInterface.inspectElement(
        0,
        elementId,
        null,
        true,
      );
      const source: IStandardSourceShape | undefined = readInspectedElementSource(inspectedElement);

      if (source === undefined) {
        continue;
      }

      return {
        columnNumber: source.columnNumber,
        componentName: rendererInterface.getDisplayNameForElementID(elementId) ?? undefined,
        fileName: source.fileName,
        lineNumber: source.lineNumber,
      };
    } catch {
      continue;
    }
  }

  return undefined;
}

function isReactFiberNode(value: unknown): value is IReactFiberNode {
  return (
    isRecord(value) &&
    [
      "_debugOwner",
      "return",
      "memoizedProps",
      "type",
      "_debugSource",
      "_source",
      "__source",
      "debugSource",
    ].some((propertyName: string): boolean => propertyName in value)
  );
}

function isReactDevToolsRendererInterface(
  value: unknown,
): value is IReactDevToolsRendererInterface {
  return (
    isRecord(value) &&
    typeof Reflect.get(value, "getDisplayNameForElementID") === "function" &&
    typeof Reflect.get(value, "getElementIDForHostInstance") === "function" &&
    typeof Reflect.get(value, "inspectElement") === "function"
  );
}

function isReactRenderer(value: unknown): value is IReactRenderer {
  return isRecord(value) && typeof Reflect.get(value, "findFiberByHostInstance") === "function";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isReactFunctionLocationTuple(value: unknown): value is IReactFunctionLocationTuple {
  return (
    Array.isArray(value) &&
    value.length >= 4 &&
    typeof value[0] === "string" &&
    typeof value[1] === "string" &&
    typeof value[2] === "number" &&
    typeof value[3] === "number"
  );
}

function isReactStackFrameTuple(value: unknown): value is IReactStackFrameTuple {
  return (
    Array.isArray(value) &&
    value.length >= 7 &&
    typeof value[0] === "string" &&
    typeof value[1] === "string" &&
    typeof value[2] === "number" &&
    typeof value[3] === "number" &&
    typeof value[4] === "number" &&
    typeof value[5] === "number" &&
    typeof value[6] === "boolean"
  );
}

function isStandardSourceShape(value: unknown): value is IStandardSourceShape {
  return (
    isRecord(value) &&
    typeof Reflect.get(value, "fileName") === "string" &&
    typeof Reflect.get(value, "lineNumber") === "number" &&
    (Reflect.get(value, "columnNumber") === undefined ||
      typeof Reflect.get(value, "columnNumber") === "number")
  );
}

function readComponentName(fiber: IReactFiberNode): string | undefined {
  const componentType: unknown = fiber.type;

  if (typeof componentType === "string" || !isRecord(componentType)) {
    return undefined;
  }

  const directDisplayName: string | undefined = readNamedProperty(componentType, "displayName");

  if (directDisplayName !== undefined) {
    return directDisplayName;
  }

  const directName: string | undefined = readNamedProperty(componentType, "name");

  if (directName !== undefined) {
    return directName;
  }

  const renderedType: unknown = Reflect.get(componentType, "render");

  if (isRecord(renderedType)) {
    const renderedDisplayName: string | undefined = readNamedProperty(renderedType, "displayName");

    if (renderedDisplayName !== undefined) {
      return renderedDisplayName;
    }

    const renderedName: string | undefined = readNamedProperty(renderedType, "name");

    if (renderedName !== undefined) {
      return renderedName;
    }
  }

  const nestedType: unknown = Reflect.get(componentType, "type");

  if (isRecord(nestedType)) {
    const nestedDisplayName: string | undefined = readNamedProperty(nestedType, "displayName");

    if (nestedDisplayName !== undefined) {
      return nestedDisplayName;
    }

    return readNamedProperty(nestedType, "name");
  }

  return undefined;
}

function readDirectSource(fiber: IReactFiberNode): IStandardSourceShape | null {
  const directSourceCandidates: readonly unknown[] = [
    Reflect.get(fiber, "_debugSource"),
    Reflect.get(fiber, "__source"),
    Reflect.get(fiber, "_source"),
    Reflect.get(fiber, "debugSource"),
  ];

  for (const sourceCandidate of directSourceCandidates) {
    if (isStandardSourceShape(sourceCandidate)) {
      return sourceCandidate;
    }
  }

  const memoizedProps: unknown = Reflect.get(fiber, "memoizedProps");

  if (!isRecord(memoizedProps)) {
    return null;
  }

  const propSource: unknown = Reflect.get(memoizedProps, "__source");

  return isStandardSourceShape(propSource) ? propSource : null;
}

function readInspectedElementSource(
  inspectedElement: IDevToolsInspectElementPayload,
): IStandardSourceShape | undefined {
  const directSource: IStandardSourceShape | undefined = normalizeInspectedSource(
    inspectedElement.value?.source,
  );

  if (directSource !== undefined) {
    return directSource;
  }

  const stack: unknown = inspectedElement.value?.stack;

  if (!Array.isArray(stack)) {
    return undefined;
  }

  for (const stackFrame of stack) {
    if (!isReactStackFrameTuple(stackFrame)) {
      continue;
    }

    return {
      columnNumber: stackFrame[3],
      fileName: stackFrame[1],
      lineNumber: stackFrame[2],
    };
  }

  return undefined;
}

function normalizeInspectedSource(
  value: IReactFunctionLocationTuple | IStandardSourceShape | null | undefined,
): IStandardSourceShape | undefined {
  if (isStandardSourceShape(value)) {
    return value;
  }

  if (isReactFunctionLocationTuple(value)) {
    return {
      columnNumber: value[3],
      fileName: value[1],
      lineNumber: value[2],
    };
  }

  return undefined;
}

function readNamedProperty(
  value: Record<string, unknown>,
  propertyName: string,
): string | undefined {
  const propertyValue: unknown = Reflect.get(value, propertyName);

  return typeof propertyValue === "string" && propertyValue.length > 0 ? propertyValue : undefined;
}

function readOwnerFiber(fiber: IReactFiberNode): IReactFiberNode | null {
  const ownerFiber: unknown = Reflect.get(fiber, "_debugOwner");

  return isReactFiberNode(ownerFiber) ? ownerFiber : null;
}

function readParentFiber(fiber: IReactFiberNode): IReactFiberNode | null {
  const parentFiber: unknown = Reflect.get(fiber, "return");

  return isReactFiberNode(parentFiber) ? parentFiber : null;
}

function readReactDevToolsHook(): IReactDevToolsHook | null {
  if (typeof window !== "object") {
    return null;
  }

  const hook: unknown = Reflect.get(window, "__REACT_DEVTOOLS_GLOBAL_HOOK__");

  return isRecord(hook) ? hook : null;
}
