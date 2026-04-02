import { useCallback, useState } from "preact/hooks";

import {
  DEVTOOLS_CONTROL_TOKEN_HEADER_NAME,
  PI_SESSION_START_PATH,
} from "../../shared/constants";
import { readDevtoolsControlToken } from "../../shared/readDevtoolsControlToken";
import type { IAnnotationSubmitDetail } from "../annotationComposer/types";
import type { IAnnotationSubmitResult, IStartPiSessionResponse } from "./types";

interface IUsePiTerminalSessionResult {
  activeSessionId: string | null;
  closePanel: () => void;
  submitAnnotation: (annotation: IAnnotationSubmitDetail) => Promise<IAnnotationSubmitResult>;
}

export function usePiTerminalSession(): IUsePiTerminalSessionResult {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const closePanel = useCallback((): void => {
    setActiveSessionId(null);
  }, []);

  const submitAnnotation = useCallback(async (annotation: IAnnotationSubmitDetail): Promise<IAnnotationSubmitResult> => {
    if (activeSessionId !== null) {
      return {
        errorMessage: "Close the active Pi terminal before starting another annotation run.",
        success: false,
      };
    }

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

      setActiveSessionId(responseBody.sessionId);

      return {
        success: true,
      };
    } catch (error) {
      return {
        errorMessage: error instanceof Error ? error.message : String(error),
        success: false,
      };
    }
  }, [activeSessionId]);

  return {
    activeSessionId,
    closePanel,
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
