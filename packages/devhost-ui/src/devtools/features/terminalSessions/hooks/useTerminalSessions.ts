import { useCallback, useEffect, useState } from "react";

import { TERMINAL_SESSION_START_PATH } from "../../../shared/constants";
import type { DevtoolsColorScheme } from "../../../shared/DevtoolsColorScheme";
import { pristineFetch } from "../../../shared/pristineFetch";
import type { IAnnotationAction } from "../../../shared/devtoolsConfig";
import type { IAnnotationSubmitDetail } from "../../annotationComposer/types";
import type { ComponentSourceMenuItem } from "../../componentSourceNavigation/types";
import { appendStartedTerminalSessionIfNeeded } from "../appendStartedTerminalSessionIfNeeded";
import { createAnnotationTerminalSessionRequest } from "../createAnnotationTerminalSessionRequest";
import { createTerminalSession } from "../createTerminalSession";
import { isListTerminalSessionsResponse } from "../isListTerminalSessionsResponse";
import {
  expandTerminalSession,
  minimizeTerminalSession,
  removeTerminalSession,
  updateTerminalSessionStatus,
} from "../manageTerminalSessions";
import { restoreTerminalSessions } from "../restoreTerminalSessions";
import type {
  ActiveTerminalSessionSnapshot,
  IStartEditorTerminalSessionRequest,
  StartAnnotationTerminalSessionRequest,
  StartTerminalSessionRequest,
  IStartTerminalSessionResponse,
  TerminalSession,
  ITerminalSessionStartResult,
  TerminalSessionStatus,
} from "../types";

interface IUseTerminalSessionsResult {
  expandSession: (sessionId: string) => void;
  minimizeSession: (sessionId: string) => void;
  registerStartedSession: (snapshot: ActiveTerminalSessionSnapshot) => void;
  terminalSessions: TerminalSession[];
  removeSession: (sessionId: string) => void;
  startComponentSourceSession: (menuItem: ComponentSourceMenuItem) => Promise<ITerminalSessionStartResult>;
  submitAnnotation: (
    annotation: IAnnotationSubmitDetail,
    action: IAnnotationAction,
    targetSessionId?: string,
  ) => Promise<ITerminalSessionStartResult>;
  updateSessionStatus: (sessionId: string, status: TerminalSessionStatus, errorMessage: string | null) => void;
}

export function useTerminalSessions(
  colorScheme: DevtoolsColorScheme,
  enabled: boolean = true,
): IUseTerminalSessionsResult {
  const [terminalSessions, setTerminalSessions] = useState<TerminalSession[]>([]);

  useEffect((): void => {
    if (!enabled) {
      setTerminalSessions([]);
      return;
    }

    void restoreActiveTerminalSessions(setTerminalSessions);
  }, [enabled]);

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

  const updateSessionStatus = useCallback(
    (sessionId: string, status: TerminalSessionStatus, errorMessage: string | null): void => {
      setTerminalSessions((currentSessions: TerminalSession[]): TerminalSession[] => {
        return updateTerminalSessionStatus(currentSessions, sessionId, status, errorMessage);
      });
    },
    [],
  );

  const registerStartedSession = useCallback((snapshot: ActiveTerminalSessionSnapshot): void => {
    setTerminalSessions((currentSessions: TerminalSession[]): TerminalSession[] => {
      return appendStartedTerminalSessionIfNeeded(currentSessions, createTerminalSession(snapshot));
    });
  }, []);

  const startSession = useCallback(
    async (
      request: StartTerminalSessionRequest,
      createSnapshot: CreateTerminalSessionSnapshot,
    ): Promise<ITerminalSessionStartResult> => {
      if (!enabled) {
        return {
          errorMessage: "Terminal sessions are not supported by this runtime.",
          success: false,
        };
      }

      try {
        const response = await pristineFetch(TERMINAL_SESSION_START_PATH, {
          body: JSON.stringify(request),
          headers: {
            "content-type": "application/json",
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

        registerStartedSession(createSnapshot(responseBody.sessionId));

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
    [enabled, registerStartedSession],
  );

  const submitAnnotation = useCallback(
    async (
      annotation: IAnnotationSubmitDetail,
      action: IAnnotationAction,
      targetSessionId?: string,
    ): Promise<ITerminalSessionStartResult> => {
      const request: StartAnnotationTerminalSessionRequest = createAnnotationTerminalSessionRequest({
        action,
        annotation,
        colorScheme,
        targetSessionId,
      });

      return await startSession(request, (sessionId: string): ActiveTerminalSessionSnapshot => {
        return { label: action.label, request, sessionId };
      });
    },
    [colorScheme, startSession],
  );

  const startComponentSourceSession = useCallback(
    async (menuItem: ComponentSourceMenuItem): Promise<ITerminalSessionStartResult> => {
      const request: IStartEditorTerminalSessionRequest = {
        pageUrl: window.location.href,
        componentName: menuItem.displayName,
        kind: "editor",
        launcher: "neovim",
        source: menuItem.source,
        sourceLabel: menuItem.sourceLabel,
      };

      return await startSession(request, (sessionId: string): ActiveTerminalSessionSnapshot => {
        return { request, sessionId };
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
    updateSessionStatus,
  };
}

type SetTerminalSessionsCallback = (value: (currentSessions: TerminalSession[]) => TerminalSession[]) => void;

// Describes a session this page just started, once the server has assigned its id.
type CreateTerminalSessionSnapshot = (sessionId: string) => ActiveTerminalSessionSnapshot;

async function restoreActiveTerminalSessions(setTerminalSessions: SetTerminalSessionsCallback): Promise<void> {
  try {
    const response = await pristineFetch(TERMINAL_SESSION_START_PATH, {
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
      return restoreTerminalSessions(currentSessions, responseBody.sessions);
    });
  } catch {
    return;
  }
}

function isStartSessionResponse(value: unknown): value is IStartTerminalSessionResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const sessionId: unknown = Reflect.get(value, "sessionId");

  return typeof sessionId === "string" && sessionId.length > 0;
}
