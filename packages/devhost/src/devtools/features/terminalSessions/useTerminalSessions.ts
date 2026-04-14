import { useCallback, useEffect, useState } from "react";

import { DEVTOOLS_CONTROL_TOKEN_HEADER_NAME, TERMINAL_SESSION_START_PATH } from "../../shared/constants";
import { readDevtoolsAgentDisplayName } from "../../shared/readDevtoolsAgentDisplayName";
import { readDevtoolsControlToken } from "../../shared/readDevtoolsControlToken";
import type { ComponentSourceMenuItem } from "../componentSourceNavigation/types";
import type { IAnnotationSubmitDetail } from "../annotationComposer/types";
import { appendStartedTerminalSessionIfNeeded } from "./appendStartedTerminalSessionIfNeeded";
import { createTerminalSession } from "./createTerminalSession";
import { expandTerminalSession, minimizeTerminalSession, removeTerminalSession } from "./manageTerminalSessions";
import { restoreTerminalSessions } from "./restoreTerminalSessions";
import type {
  IActiveTerminalSessionSnapshot,
  IListTerminalSessionsResponse,
  StartTerminalSessionRequest,
  IStartTerminalSessionResponse,
  TerminalSession,
  ITerminalSessionStartResult,
} from "./types";

interface IUseTerminalSessionsResult {
  expandSession: (sessionId: string) => void;
  minimizeSession: (sessionId: string) => void;
  registerStartedSession: (sessionId: string, request: StartTerminalSessionRequest) => void;
  terminalSessions: TerminalSession[];
  removeSession: (sessionId: string) => void;
  startComponentSourceSession: (menuItem: ComponentSourceMenuItem) => Promise<ITerminalSessionStartResult>;
  submitAnnotation: (
    annotation: IAnnotationSubmitDetail,
    targetSessionId?: string,
  ) => Promise<ITerminalSessionStartResult>;
}

export function useTerminalSessions(): IUseTerminalSessionsResult {
  const [terminalSessions, setTerminalSessions] = useState<TerminalSession[]>([]);
  const agentDisplayName: string = readDevtoolsAgentDisplayName();

  useEffect((): void => {
    void restoreActiveTerminalSessions(setTerminalSessions, agentDisplayName);
  }, [agentDisplayName]);

  const expandSession = useCallback((sessionId: string): void => {
    setTerminalSessions((currentSessions: TerminalSession[]): TerminalSession[] => {
      return expandTerminalSession(currentSessions, sessionId);
    });
  }, []);

  const minimizeSession = useCallback((sessionId: string): void => {
    setTerminalSessions((currentSessions: TerminalSession[]): TerminalSession[] => {
      return minimizeTerminalSession(currentSessions, sessionId);
    });
  }, []);

  const removeSession = useCallback((sessionId: string): void => {
    setTerminalSessions((currentSessions: TerminalSession[]): TerminalSession[] => {
      return removeTerminalSession(currentSessions, sessionId);
    });
  }, []);

  const registerStartedSession = useCallback(
    (sessionId: string, request: StartTerminalSessionRequest): void => {
      setTerminalSessions((currentSessions: TerminalSession[]): TerminalSession[] => {
        return appendStartedTerminalSessionIfNeeded(
          currentSessions,
          createTerminalSession(sessionId, request, agentDisplayName),
        );
      });
    },
    [agentDisplayName],
  );

  const startSession = useCallback(
    async (request: StartTerminalSessionRequest): Promise<ITerminalSessionStartResult> => {
      try {
        const response = await fetch(TERMINAL_SESSION_START_PATH, {
          body: JSON.stringify(request),
          headers: {
            "content-type": "application/json",
            [DEVTOOLS_CONTROL_TOKEN_HEADER_NAME]: readDevtoolsControlToken(),
          },
          method: "POST",
        });

        if (!response.ok) {
          return {
            errorMessage: await response.text(),
            success: false,
          };
        }

        const responseBody: unknown = await response.json();

        if (!isStartSessionResponse(responseBody)) {
          return {
            errorMessage: "Terminal session start returned an invalid response.",
            success: false,
          };
        }

        registerStartedSession(responseBody.sessionId, request);

        return {
          success: true,
        };
      } catch (error) {
        return {
          errorMessage: error instanceof Error ? error.message : String(error),
          success: false,
        };
      }
    },
    [registerStartedSession],
  );

  const submitAnnotation = useCallback(
    async (annotation: IAnnotationSubmitDetail, targetSessionId?: string): Promise<ITerminalSessionStartResult> => {
      return await startSession({
        annotation,
        kind: "agent",
        targetSessionId,
      });
    },
    [startSession],
  );

  const startComponentSourceSession = useCallback(
    async (menuItem: ComponentSourceMenuItem): Promise<ITerminalSessionStartResult> => {
      return await startSession({
        componentName: menuItem.displayName,
        kind: "editor",
        launcher: "neovim",
        source: menuItem.source,
        sourceLabel: menuItem.sourceLabel,
      });
    },
    [startSession],
  );

  return {
    expandSession,
    minimizeSession,
    registerStartedSession,
    terminalSessions,
    removeSession,
    startComponentSourceSession,
    submitAnnotation,
  };
}

type SetTerminalSessionsCallback = (value: (currentSessions: TerminalSession[]) => TerminalSession[]) => void;

async function restoreActiveTerminalSessions(
  setTerminalSessions: SetTerminalSessionsCallback,
  agentDisplayName: string,
): Promise<void> {
  try {
    const response = await fetch(TERMINAL_SESSION_START_PATH, {
      headers: {
        [DEVTOOLS_CONTROL_TOKEN_HEADER_NAME]: readDevtoolsControlToken(),
      },
      method: "GET",
    });

    if (!response.ok) {
      return;
    }

    const responseBody: unknown = await response.json();

    if (!isListTerminalSessionsResponse(responseBody)) {
      return;
    }

    setTerminalSessions((currentSessions: TerminalSession[]): TerminalSession[] => {
      return restoreTerminalSessions(currentSessions, responseBody.sessions, agentDisplayName);
    });
  } catch {
    return;
  }
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

function isListTerminalSessionsResponse(value: unknown): value is IListTerminalSessionsResponse {
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

function isStartSessionResponse(value: unknown): value is IStartTerminalSessionResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const sessionId: unknown = Reflect.get(value, "sessionId");

  return typeof sessionId === "string" && sessionId.length > 0;
}

function isStartTerminalSessionRequest(value: unknown): value is StartTerminalSessionRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const requestKind: unknown = Reflect.get(value, "kind");
  const launcher: unknown = Reflect.get(value, "launcher");

  if (requestKind === "agent") {
    const annotation: unknown = Reflect.get(value, "annotation");
    const targetSessionId: unknown = Reflect.get(value, "targetSessionId");

    if (targetSessionId !== undefined && typeof targetSessionId !== "string") {
      return false;
    }

    return isAnnotationSubmitDetail(annotation);
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
