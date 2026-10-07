import type {
  IActiveTerminalSessionSnapshot,
  IListTerminalSessionsResponse,
  StartTerminalSessionRequest,
} from "./types";

// Validates the control server's session list. A listed request is the stored terminalSessionRequest from
// apps/devhost/internal/devtools/terminal.go, so every field checked here must be one the server sends.
export function isListTerminalSessionsResponse(value: unknown): value is IListTerminalSessionsResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const sessions: unknown = Reflect.get(value, "sessions");

  return (
    Array.isArray(sessions) &&
    sessions.every((session: unknown): session is IActiveTerminalSessionSnapshot => {
      return isActiveTerminalSessionSnapshot(session);
    })
  );
}

function isActiveTerminalSessionSnapshot(value: unknown): value is IActiveTerminalSessionSnapshot {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const request: unknown = Reflect.get(value, "request");
  const sessionId: unknown = Reflect.get(value, "sessionId");

  return typeof sessionId === "string" && sessionId.length > 0 && isStartTerminalSessionRequest(request);
}

function isAnnotationMarkerPayload(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const accessibility: unknown = Reflect.get(value, "accessibility");
  const boundingBox: unknown = Reflect.get(value, "boundingBox");
  const computedStyles: unknown = Reflect.get(value, "computedStyles");
  const computedStylesObj: unknown = Reflect.get(value, "computedStylesObj");
  const cssClasses: unknown = Reflect.get(value, "cssClasses");
  const element: unknown = Reflect.get(value, "element");
  const elementPath: unknown = Reflect.get(value, "elementPath");
  const fullPath: unknown = Reflect.get(value, "fullPath");
  const isFixed: unknown = Reflect.get(value, "isFixed");
  const markerNumber: unknown = Reflect.get(value, "markerNumber");
  const nearbyElements: unknown = Reflect.get(value, "nearbyElements");
  const nearbyText: unknown = Reflect.get(value, "nearbyText");
  const selectedText: unknown = Reflect.get(value, "selectedText");

  return (
    typeof accessibility === "string" &&
    isRectSnapshot(boundingBox) &&
    isStringRecord(computedStylesObj) &&
    typeof computedStyles === "string" &&
    typeof cssClasses === "string" &&
    typeof element === "string" &&
    typeof elementPath === "string" &&
    typeof fullPath === "string" &&
    typeof isFixed === "boolean" &&
    typeof markerNumber === "number" &&
    typeof nearbyElements === "string" &&
    typeof nearbyText === "string" &&
    (typeof selectedText === "string" || selectedText === undefined)
  );
}

function isAnnotationSubmitDetail(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const comment: unknown = Reflect.get(value, "comment");
  const markers: unknown = Reflect.get(value, "markers");
  const stackName: unknown = Reflect.get(value, "stackName");
  const submittedAt: unknown = Reflect.get(value, "submittedAt");
  const title: unknown = Reflect.get(value, "title");
  const url: unknown = Reflect.get(value, "url");

  return (
    typeof comment === "string" &&
    Array.isArray(markers) &&
    markers.every((marker: unknown): boolean => isAnnotationMarkerPayload(marker)) &&
    typeof stackName === "string" &&
    typeof submittedAt === "number" &&
    typeof title === "string" &&
    typeof url === "string"
  );
}

function isRectSnapshot(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const height: unknown = Reflect.get(value, "height");
  const width: unknown = Reflect.get(value, "width");
  const x: unknown = Reflect.get(value, "x");
  const y: unknown = Reflect.get(value, "y");

  return typeof height === "number" && typeof width === "number" && typeof x === "number" && typeof y === "number";
}

function isSourceLocation(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const fileName: unknown = Reflect.get(value, "fileName");
  const lineNumber: unknown = Reflect.get(value, "lineNumber");
  const columnNumber: unknown = Reflect.get(value, "columnNumber");
  const componentName: unknown = Reflect.get(value, "componentName");

  return (
    typeof fileName === "string" &&
    typeof lineNumber === "number" &&
    Number.isInteger(lineNumber) &&
    lineNumber > 0 &&
    (columnNumber === undefined ||
      (typeof columnNumber === "number" && Number.isInteger(columnNumber) && columnNumber > 0)) &&
    (componentName === undefined || typeof componentName === "string")
  );
}

function isStartTerminalSessionRequest(value: unknown): value is StartTerminalSessionRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const requestKind: unknown = Reflect.get(value, "kind");
  const launcher: unknown = Reflect.get(value, "launcher");

  if (requestKind === "agent") {
    const actionId: unknown = Reflect.get(value, "actionId");
    const annotation: unknown = Reflect.get(value, "annotation");
    const colorScheme: unknown = Reflect.get(value, "colorScheme");
    const targetSessionId: unknown = Reflect.get(value, "targetSessionId");

    if (targetSessionId !== undefined && typeof targetSessionId !== "string") {
      return false;
    }

    if (colorScheme !== undefined && colorScheme !== "light" && colorScheme !== "dark") {
      return false;
    }

    return typeof actionId === "string" && isAnnotationSubmitDetail(annotation);
  }

  if (requestKind === "command") {
    const actionId: unknown = Reflect.get(value, "actionId");
    const annotation: unknown = Reflect.get(value, "annotation");

    return typeof actionId === "string" && isAnnotationSubmitDetail(annotation);
  }

  if (requestKind === "editor") {
    const componentName: unknown = Reflect.get(value, "componentName");
    const source: unknown = Reflect.get(value, "source");
    const sourceLabel: unknown = Reflect.get(value, "sourceLabel");

    return (
      launcher === "neovim" &&
      typeof componentName === "string" &&
      isSourceLocation(source) &&
      typeof sourceLabel === "string"
    );
  }

  return false;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return Object.values(value).every((entry: unknown): boolean => typeof entry === "string");
}
