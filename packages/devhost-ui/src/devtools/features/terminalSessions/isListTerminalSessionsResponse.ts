import type {
  ActiveTerminalSessionSnapshot,
  IListTerminalSessionsResponse,
  IStartEditorTerminalSessionRequest,
  StartAnnotationTerminalSessionRequest,
} from "./types";

// Validates the control server's session list. Each entry is an activeTerminalSessionSnapshot from
// apps/devhost/internal/devtools/terminal.go, so every field checked here must be one the server sends.
export function isListTerminalSessionsResponse(value: unknown): value is IListTerminalSessionsResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const sessions: unknown = Reflect.get(value, "sessions");

  return (
    Array.isArray(sessions) &&
    sessions.every((session: unknown): session is ActiveTerminalSessionSnapshot => {
      return isActiveTerminalSessionSnapshot(session);
    })
  );
}

function isActiveTerminalSessionSnapshot(value: unknown): value is ActiveTerminalSessionSnapshot {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const label: unknown = Reflect.get(value, "label");
  const request: unknown = Reflect.get(value, "request");
  const sessionId: unknown = Reflect.get(value, "sessionId");

  if (typeof sessionId !== "string" || sessionId.length === 0) {
    return false;
  }

  // The server labels every annotation session; an editor session has no label.
  if (isStartAnnotationTerminalSessionRequest(request)) {
    return typeof label === "string" && label.length > 0;
  }

  return isStartEditorTerminalSessionRequest(request);
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

function isStartAnnotationTerminalSessionRequest(value: unknown): value is StartAnnotationTerminalSessionRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const requestKind: unknown = Reflect.get(value, "kind");

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

  return false;
}

function isStartEditorTerminalSessionRequest(value: unknown): value is IStartEditorTerminalSessionRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const componentName: unknown = Reflect.get(value, "componentName");
  const launcher: unknown = Reflect.get(value, "launcher");
  const requestKind: unknown = Reflect.get(value, "kind");
  const source: unknown = Reflect.get(value, "source");
  const sourceLabel: unknown = Reflect.get(value, "sourceLabel");

  return (
    requestKind === "editor" &&
    launcher === "neovim" &&
    typeof componentName === "string" &&
    isSourceLocation(source) &&
    typeof sourceLabel === "string"
  );
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return Object.values(value).every((entry: unknown): boolean => typeof entry === "string");
}
