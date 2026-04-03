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

interface ISourceLocationDebugEntry {
  details?: Record<string, unknown>;
  step: string;
}

const maximumFiberDepth: number = 50;

export function getElementSourceLocation(
  element: HTMLElement,
): IAnnotationSourceLocation | undefined {
  const debugTrace: ISourceLocationDebugEntry[] = [];

  appendSourceLocationDebugEntry(debugTrace, "start", {
    element: describeElementForDebug(element),
  });

  const devToolsSourceLocation: IAnnotationSourceLocation | undefined =
    getSourceLocationFromRendererInterface(element, debugTrace);

  if (devToolsSourceLocation !== undefined) {
    appendSourceLocationDebugEntry(debugTrace, "resolved-from-renderer-interface", {
      sourceLocation: devToolsSourceLocation,
    });
    flushSourceLocationDebugTrace(element, debugTrace, devToolsSourceLocation);
    return devToolsSourceLocation;
  }

  let currentFiber: IReactFiberNode | null = getFiberFromElement(element, debugTrace);
  let depth: number = 0;

  while (currentFiber !== null && depth < maximumFiberDepth) {
    appendSourceLocationDebugEntry(debugTrace, "visit-fiber", {
      depth,
      fiber: describeFiberForDebug(currentFiber),
    });

    const directSource: IStandardSourceShape | null = readDirectSource(currentFiber);
    if (directSource !== null) {
      const sourceLocation: IAnnotationSourceLocation = createSourceLocation(
        currentFiber,
        directSource,
      );

      appendSourceLocationDebugEntry(debugTrace, "resolved-from-fiber", {
        depth,
        sourceLocation,
      });
      flushSourceLocationDebugTrace(element, debugTrace, sourceLocation);
      return sourceLocation;
    }

    const ownerFiber: IReactFiberNode | null = readOwnerFiber(currentFiber);
    if (ownerFiber !== null) {
      appendSourceLocationDebugEntry(debugTrace, "visit-owner-fiber", {
        depth,
        fiber: describeFiberForDebug(ownerFiber),
      });

      const ownerSource: IStandardSourceShape | null = readDirectSource(ownerFiber);
      if (ownerSource !== null) {
        const sourceLocation: IAnnotationSourceLocation = createSourceLocation(
          ownerFiber,
          ownerSource,
        );

        appendSourceLocationDebugEntry(debugTrace, "resolved-from-owner-fiber", {
          depth,
          sourceLocation,
        });
        flushSourceLocationDebugTrace(element, debugTrace, sourceLocation);
        return sourceLocation;
      }
    }

    currentFiber = readParentFiber(currentFiber);
    depth += 1;
  }

  appendSourceLocationDebugEntry(debugTrace, "resolution-failed", {
    reason: "no-source-metadata-found",
  });
  flushSourceLocationDebugTrace(element, debugTrace, undefined);
  return undefined;
}

function createSourceLocation(
  fiber: IReactFiberNode,
  source: IStandardSourceShape,
): IAnnotationSourceLocation {
  return {
    columnNumber: source.columnNumber,
    componentName: readComponentName(fiber),
    fileName: cleanSourcePath(source.fileName),
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

function getFiberFromDevTools(
  element: HTMLElement,
  debugTrace: ISourceLocationDebugEntry[],
): IReactFiberNode | null {
  if (typeof window !== "object") {
    appendSourceLocationDebugEntry(debugTrace, "devtools-renderer-fiber-skipped", {
      reason: "window-unavailable",
    });
    return null;
  }

  const hook: IReactDevToolsHook | null = readReactDevToolsHook();

  if (hook === null) {
    appendSourceLocationDebugEntry(debugTrace, "devtools-renderer-fiber-skipped", {
      reason: "react-devtools-hook-missing",
    });
    return null;
  }

  const renderers: unknown = hook.renderers;

  if (!(renderers instanceof Map)) {
    appendSourceLocationDebugEntry(debugTrace, "devtools-renderer-fiber-skipped", {
      reason: "renderers-map-missing",
    });
    return null;
  }

  appendSourceLocationDebugEntry(debugTrace, "devtools-renderers-discovered", {
    rendererCount: renderers.size,
  });

  let rendererIndex: number = 0;

  for (const renderer of renderers.values()) {
    rendererIndex += 1;

    if (!isReactRenderer(renderer)) {
      appendSourceLocationDebugEntry(debugTrace, "devtools-renderer-ignored", {
        reason: "invalid-renderer-shape",
        rendererIndex,
      });
      continue;
    }

    try {
      const fiber: IReactFiberNode | null = renderer.findFiberByHostInstance(element);

      appendSourceLocationDebugEntry(debugTrace, "devtools-renderer-fiber-attempt", {
        matchedFiber: isReactFiberNode(fiber),
        rendererIndex,
      });

      if (isReactFiberNode(fiber)) {
        return fiber;
      }
    } catch (error) {
      appendSourceLocationDebugEntry(debugTrace, "devtools-renderer-fiber-error", {
        errorMessage: getErrorMessage(error),
        rendererIndex,
      });
    }
  }

  appendSourceLocationDebugEntry(debugTrace, "devtools-renderer-fiber-miss", {
    reason: "no-renderer-returned-fiber",
  });
  return null;
}

function getFiberFromElement(
  element: HTMLElement,
  debugTrace: ISourceLocationDebugEntry[],
): IReactFiberNode | null {
  const fiberFromDevTools: IReactFiberNode | null = getFiberFromDevTools(element, debugTrace);

  if (fiberFromDevTools !== null) {
    appendSourceLocationDebugEntry(debugTrace, "resolved-fiber-from-devtools-renderer", {
      fiber: describeFiberForDebug(fiberFromDevTools),
    });
    return fiberFromDevTools;
  }

  const reactPropertyKeys: string[] = Object.keys(element).filter((key: string): boolean => {
    return (
      key.startsWith("__reactFiber$") ||
      key.startsWith("__reactInternalInstance$") ||
      key.startsWith("__react")
    );
  });

  appendSourceLocationDebugEntry(debugTrace, "dom-react-properties-scanned", {
    reactPropertyKeys,
  });

  for (const key of reactPropertyKeys) {
    const candidateFiber: unknown = Reflect.get(element, key);

    if (isReactFiberNode(candidateFiber)) {
      appendSourceLocationDebugEntry(debugTrace, "resolved-fiber-from-dom-property", {
        fiber: describeFiberForDebug(candidateFiber),
        key,
      });
      return candidateFiber;
    }
  }

  appendSourceLocationDebugEntry(debugTrace, "fiber-resolution-failed", {
    reason: "no-react-fiber-on-element",
  });
  return null;
}

function getSourceLocationFromRendererInterface(
  element: HTMLElement,
  debugTrace: ISourceLocationDebugEntry[],
): IAnnotationSourceLocation | undefined {
  if (typeof window !== "object") {
    appendSourceLocationDebugEntry(debugTrace, "renderer-interface-skipped", {
      reason: "window-unavailable",
    });
    return undefined;
  }

  const hook: IReactDevToolsHook | null = readReactDevToolsHook();
  const rendererInterfaces: unknown = hook?.rendererInterfaces;

  if (!(rendererInterfaces instanceof Map)) {
    appendSourceLocationDebugEntry(debugTrace, "renderer-interface-skipped", {
      reason: "renderer-interfaces-map-missing",
    });
    return undefined;
  }

  appendSourceLocationDebugEntry(debugTrace, "renderer-interfaces-discovered", {
    rendererInterfaceCount: rendererInterfaces.size,
  });

  let rendererIndex: number = 0;

  for (const rendererInterface of rendererInterfaces.values()) {
    rendererIndex += 1;

    if (!isReactDevToolsRendererInterface(rendererInterface)) {
      appendSourceLocationDebugEntry(debugTrace, "renderer-interface-ignored", {
        reason: "invalid-renderer-interface-shape",
        rendererIndex,
      });
      continue;
    }

    try {
      const elementId: number | null = rendererInterface.getElementIDForHostInstance(element);

      appendSourceLocationDebugEntry(debugTrace, "renderer-interface-element-id", {
        elementId,
        rendererIndex,
      });

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

      appendSourceLocationDebugEntry(debugTrace, "renderer-interface-inspect-result", {
        inspectedElement: summarizeInspectedElement(inspectedElement),
        rendererIndex,
        resolvedSource: source ?? null,
      });

      if (source === undefined) {
        continue;
      }

      return {
        columnNumber: source.columnNumber,
        componentName: rendererInterface.getDisplayNameForElementID(elementId) ?? undefined,
        fileName: cleanSourcePath(source.fileName),
        lineNumber: source.lineNumber,
      };
    } catch (error) {
      appendSourceLocationDebugEntry(debugTrace, "renderer-interface-error", {
        errorMessage: getErrorMessage(error),
        rendererIndex,
      });
    }
  }

  appendSourceLocationDebugEntry(debugTrace, "renderer-interface-miss", {
    reason: "no-renderer-interface-returned-source",
  });
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
  return (
    isRecord(value) &&
    typeof Reflect.get(value, "findFiberByHostInstance") === "function"
  );
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
    const renderedDisplayName: string | undefined = readNamedProperty(
      renderedType,
      "displayName",
    );

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
    const nestedDisplayName: string | undefined = readNamedProperty(
      nestedType,
      "displayName",
    );

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

  return typeof propertyValue === "string" && propertyValue.length > 0
    ? propertyValue
    : undefined;
}

function readOwnerFiber(fiber: IReactFiberNode): IReactFiberNode | null {
  const ownerFiber: unknown = Reflect.get(fiber, "_debugOwner");

  return isReactFiberNode(ownerFiber) ? ownerFiber : null;
}

function readParentFiber(fiber: IReactFiberNode): IReactFiberNode | null {
  const parentFiber: unknown = Reflect.get(fiber, "return");

  return isReactFiberNode(parentFiber) ? parentFiber : null;
}

function appendSourceLocationDebugEntry(
  debugTrace: ISourceLocationDebugEntry[],
  step: string,
  details?: Record<string, unknown>,
): void {
  debugTrace.push({
    details,
    step,
  });
}

function describeElementForDebug(element: HTMLElement): Record<string, unknown> {
  const tagName: string | null =
    typeof element.tagName === "string" ? element.tagName.toLowerCase() : null;
  const className: string | null =
    typeof element.className === "string" && element.className.length > 0 ? element.className : null;
  const textContent: string | null =
    typeof element.textContent === "string" && element.textContent.trim().length > 0
      ? element.textContent.trim().slice(0, 80)
      : null;

  return {
    className,
    dataElement: element.dataset?.element ?? null,
    id: element.id || null,
    tagName,
    textContent,
  };
}

function describeFiberForDebug(fiber: IReactFiberNode): Record<string, unknown> {
  return {
    componentName: readComponentName(fiber) ?? null,
    hasDirectSource: readDirectSource(fiber) !== null,
    hasOwnerFiber: readOwnerFiber(fiber) !== null,
    hasParentFiber: readParentFiber(fiber) !== null,
  };
}

function flushSourceLocationDebugTrace(
  element: HTMLElement,
  debugTrace: readonly ISourceLocationDebugEntry[],
  sourceLocation: IAnnotationSourceLocation | undefined,
): void {
  console.log("[devhost] Source location resolution trace", {
    element: describeElementForDebug(element),
    resolvedSourceLocation: sourceLocation ?? null,
    trace: debugTrace,
  });
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function summarizeInspectedElement(
  inspectedElement: IDevToolsInspectElementPayload,
): Record<string, unknown> {
  const stack: IReactStackFrameTuple[] | null | undefined = inspectedElement.value?.stack;

  return {
    firstStackFrame: stack?.[0] ?? null,
    source: inspectedElement.value?.source ?? null,
    stackLength: stack?.length ?? null,
    type: inspectedElement.type ?? null,
  };
}

function readReactDevToolsHook(): IReactDevToolsHook | null {
  if (typeof window !== "object") {
    return null;
  }

  const hook: unknown = Reflect.get(window, "__REACT_DEVTOOLS_GLOBAL_HOOK__");

  return isRecord(hook) ? hook : null;
}
