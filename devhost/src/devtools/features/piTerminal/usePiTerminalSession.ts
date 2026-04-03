import { useCallback, useState } from "preact/hooks";

import { DEVTOOLS_CONTROL_TOKEN_HEADER_NAME, PI_SESSION_START_PATH } from "../../shared/constants";
import { readDevtoolsControlToken } from "../../shared/readDevtoolsControlToken";
import type { IComponentSourceMenuItem } from "../componentSourceNavigation/types";
import type { IAnnotationSubmitDetail } from "../annotationComposer/types";
import {
  appendPiTerminalSession,
  expandPiTerminalSession,
  minimizePiTerminalSession,
  removePiTerminalSession,
} from "./managePiTerminalSessions";
import type {
  IStartTerminalSessionRequest,
  IStartTerminalSessionResponse,
  ITerminalSession,
  ITerminalSessionStartResult,
} from "./types";

interface IUsePiTerminalSessionResult {
  expandSession: (sessionId: string) => void;
  minimizeSession: (sessionId: string) => void;
  piTerminalSessions: ITerminalSession[];
  removeSession: (sessionId: string) => void;
  startComponentSourceSession: (menuItem: IComponentSourceMenuItem) => Promise<ITerminalSessionStartResult>;
  submitAnnotation: (annotation: IAnnotationSubmitDetail) => Promise<ITerminalSessionStartResult>;
}

export function usePiTerminalSession(): IUsePiTerminalSessionResult {
  const [piTerminalSessions, setPiTerminalSessions] = useState<ITerminalSession[]>([]);

  const expandSession = useCallback((sessionId: string): void => {
    setPiTerminalSessions((currentSessions: ITerminalSession[]): ITerminalSession[] => {
      return expandPiTerminalSession(currentSessions, sessionId);
    });
  }, []);

  const minimizeSession = useCallback((sessionId: string): void => {
    setPiTerminalSessions((currentSessions: ITerminalSession[]): ITerminalSession[] => {
      return minimizePiTerminalSession(currentSessions, sessionId);
    });
  }, []);

  const removeSession = useCallback((sessionId: string): void => {
    setPiTerminalSessions((currentSessions: ITerminalSession[]): ITerminalSession[] => {
      return removePiTerminalSession(currentSessions, sessionId);
    });
  }, []);

  const startSession = useCallback(
    async (
      request: IStartTerminalSessionRequest,
      createSession: (sessionId: string) => ITerminalSession,
    ): Promise<ITerminalSessionStartResult> => {
      try {
        const response = await fetch(PI_SESSION_START_PATH, {
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

        setPiTerminalSessions((currentSessions: ITerminalSession[]): ITerminalSession[] => {
          return appendPiTerminalSession(currentSessions, createSession(responseBody.sessionId));
        });

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
    [],
  );

  const submitAnnotation = useCallback(async (annotation: IAnnotationSubmitDetail): Promise<ITerminalSessionStartResult> => {
    return await startSession(
      {
        annotation,
        kind: "pi-annotation",
      },
      (sessionId: string): ITerminalSession => {
        return {
          annotation,
          isExpanded: false,
          kind: "pi-annotation",
          sessionId,
        };
      },
    );
  }, [startSession]);

  const startComponentSourceSession = useCallback(
    async (menuItem: IComponentSourceMenuItem): Promise<ITerminalSessionStartResult> => {
      return await startSession(
        {
          componentName: menuItem.displayName,
          kind: "component-source",
          source: menuItem.source,
          sourceLabel: menuItem.sourceLabel,
        },
        (sessionId: string): ITerminalSession => {
          return {
            componentName: menuItem.displayName,
            isExpanded: true,
            kind: "component-source",
            sessionId,
            sourceLabel: menuItem.sourceLabel,
          };
        },
      );
    },
    [startSession],
  );

  return {
    expandSession,
    minimizeSession,
    piTerminalSessions,
    removeSession,
    startComponentSourceSession,
    submitAnnotation,
  };
}

function isStartSessionResponse(value: unknown): value is IStartTerminalSessionResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const sessionId: unknown = Reflect.get(value, "sessionId");

  return typeof sessionId === "string" && sessionId.length > 0;
}
