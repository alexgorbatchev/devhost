import { useCallback, useState } from "preact/hooks";

import { DEVTOOLS_CONTROL_TOKEN_HEADER_NAME, PI_SESSION_START_PATH } from "../../shared/constants";
import { readDevtoolsControlToken } from "../../shared/readDevtoolsControlToken";
import type { IAnnotationSubmitDetail } from "../annotationComposer/types";
import {
  appendPiTerminalSession,
  expandPiTerminalSession,
  minimizePiTerminalSession,
  removePiTerminalSession,
} from "./managePiTerminalSessions";
import type { IAnnotationSubmitResult, IPiTerminalSession, IStartPiSessionResponse } from "./types";

interface IUsePiTerminalSessionResult {
  expandSession: (sessionId: string) => void;
  minimizeSession: (sessionId: string) => void;
  piTerminalSessions: IPiTerminalSession[];
  removeSession: (sessionId: string) => void;
  submitAnnotation: (annotation: IAnnotationSubmitDetail) => Promise<IAnnotationSubmitResult>;
}

export function usePiTerminalSession(): IUsePiTerminalSessionResult {
  const [piTerminalSessions, setPiTerminalSessions] = useState<IPiTerminalSession[]>([]);

  const expandSession = useCallback((sessionId: string): void => {
    setPiTerminalSessions((currentSessions: IPiTerminalSession[]): IPiTerminalSession[] => {
      return expandPiTerminalSession(currentSessions, sessionId);
    });
  }, []);

  const minimizeSession = useCallback((sessionId: string): void => {
    setPiTerminalSessions((currentSessions: IPiTerminalSession[]): IPiTerminalSession[] => {
      return minimizePiTerminalSession(currentSessions, sessionId);
    });
  }, []);

  const removeSession = useCallback((sessionId: string): void => {
    setPiTerminalSessions((currentSessions: IPiTerminalSession[]): IPiTerminalSession[] => {
      return removePiTerminalSession(currentSessions, sessionId);
    });
  }, []);

  const submitAnnotation = useCallback(async (annotation: IAnnotationSubmitDetail): Promise<IAnnotationSubmitResult> => {
    try {
      const response = await fetch(PI_SESSION_START_PATH, {
        body: JSON.stringify({ annotation }),
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

      if (!isStartPiSessionResponse(responseBody)) {
        return {
          errorMessage: "Pi session start returned an invalid response.",
          success: false,
        };
      }

      setPiTerminalSessions((currentSessions: IPiTerminalSession[]): IPiTerminalSession[] => {
        return appendPiTerminalSession(currentSessions, {
          annotation,
          isExpanded: false,
          sessionId: responseBody.sessionId,
        });
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
  }, []);

  return {
    expandSession,
    minimizeSession,
    piTerminalSessions,
    removeSession,
    submitAnnotation,
  };
}

function isStartPiSessionResponse(value: unknown): value is IStartPiSessionResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const sessionId: unknown = Reflect.get(value, "sessionId");

  return typeof sessionId === "string" && sessionId.length > 0;
}
