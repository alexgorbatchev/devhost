import { useCallback, useState } from "preact/hooks";

import { DEVTOOLS_CONTROL_TOKEN_HEADER_NAME, TERMINAL_SESSION_START_PATH } from "../../shared/constants";
import { readDevtoolsControlToken } from "../../shared/readDevtoolsControlToken";
import type { IComponentSourceMenuItem } from "../componentSourceNavigation/types";
import type { IAnnotationSubmitDetail } from "../annotationComposer/types";
import {
  appendTerminalSession,
  expandTerminalSession,
  minimizeTerminalSession,
  removeTerminalSession,
} from "./manageTerminalSessions";
import { readTerminalSessionKindConfig } from "./readTerminalSessionKindConfig";
import type {
  IStartTerminalSessionRequest,
  IStartTerminalSessionResponse,
  ITerminalSession,
  ITerminalSessionStartResult,
} from "./types";

interface IUseTerminalSessionsResult {
  expandSession: (sessionId: string) => void;
  minimizeSession: (sessionId: string) => void;
  terminalSessions: ITerminalSession[];
  removeSession: (sessionId: string) => void;
  startComponentSourceSession: (menuItem: IComponentSourceMenuItem) => Promise<ITerminalSessionStartResult>;
  submitAnnotation: (annotation: IAnnotationSubmitDetail) => Promise<ITerminalSessionStartResult>;
}

export function useTerminalSessions(): IUseTerminalSessionsResult {
  const [terminalSessions, setTerminalSessions] = useState<ITerminalSession[]>([]);

  const expandSession = useCallback((sessionId: string): void => {
    setTerminalSessions((currentSessions: ITerminalSession[]): ITerminalSession[] => {
      return expandTerminalSession(currentSessions, sessionId);
    });
  }, []);

  const minimizeSession = useCallback((sessionId: string): void => {
    setTerminalSessions((currentSessions: ITerminalSession[]): ITerminalSession[] => {
      return minimizeTerminalSession(currentSessions, sessionId);
    });
  }, []);

  const removeSession = useCallback((sessionId: string): void => {
    setTerminalSessions((currentSessions: ITerminalSession[]): ITerminalSession[] => {
      return removeTerminalSession(currentSessions, sessionId);
    });
  }, []);

  const startSession = useCallback(
    async (
      request: IStartTerminalSessionRequest,
      createSession: (sessionId: string) => ITerminalSession,
    ): Promise<ITerminalSessionStartResult> => {
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

        setTerminalSessions((currentSessions: ITerminalSession[]): ITerminalSession[] => {
          return appendTerminalSession(currentSessions, createSession(responseBody.sessionId));
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
          isExpanded: readTerminalSessionKindConfig("pi-annotation").defaultIsExpanded,
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
            isExpanded: readTerminalSessionKindConfig("component-source").defaultIsExpanded,
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
    terminalSessions,
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
