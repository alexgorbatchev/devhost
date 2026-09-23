import type { DevtoolsColorScheme } from "../../shared/DevtoolsColorScheme";
import type { IAnnotationAction } from "../../shared/devtoolsConfig";
import type { IAnnotationSubmitDetail } from "../annotationComposer/types";
import type { IStartAgentTerminalSessionRequest, IStartCommandTerminalSessionRequest } from "./types";

interface ICreateAnnotationTerminalSessionRequestOptions {
  action: IAnnotationAction;
  annotation: IAnnotationSubmitDetail;
  colorScheme: DevtoolsColorScheme;
  targetSessionId?: string;
}

// Agent sessions receive the devtools color scheme so agent CLIs render for the terminal palette they are shown in.
export function createAnnotationTerminalSessionRequest({
  action,
  annotation,
  colorScheme,
  targetSessionId,
}: ICreateAnnotationTerminalSessionRequestOptions):
  | IStartAgentTerminalSessionRequest
  | IStartCommandTerminalSessionRequest {
  if (action.kind === "agent") {
    return {
      actionId: action.id,
      annotation,
      colorScheme,
      displayName: action.displayName,
      kind: "agent",
      targetSessionId,
    };
  }

  return {
    actionId: action.id,
    annotation,
    displayName: action.displayName,
    kind: "command",
  };
}
