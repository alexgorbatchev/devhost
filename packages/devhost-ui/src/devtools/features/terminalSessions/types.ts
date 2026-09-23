import type { ISourceLocation } from "../../shared/sourceLocation";
import type { IAnnotationSubmitDetail } from "../annotationComposer/types";

export interface ITerminalSessionBehavior {
  defaultIsExpanded: boolean;
  isFullscreenExpanded: boolean;
  shouldAutoRemoveOnExit: boolean;
}

export interface ITerminalSessionSummary {
  chipLabel: string;
  meta: string[];
  title: string;
}

/**
 * Lifecycle of a terminal session as observed by the browser:
 * - `connecting` until the websocket opens, then `running`.
 * - `working` / `idle` come from the agent's OSC 1337 `SetAgentStatus` reports (idle = task finished, the agent
 *   process is still alive and waiting).
 * - `exited` once the process exits, `disconnected` when the socket closes first, `error` on transport failures.
 */
export type TerminalSessionStatus = "connecting" | "disconnected" | "error" | "exited" | "idle" | "running" | "working";

export type EditorTerminalLauncher = "neovim";

export interface IStartAgentTerminalSessionRequest {
  annotation: IAnnotationSubmitDetail;
  actionId: string;
  displayName: string;
  kind: "agent";
  targetSessionId?: string;
}

export interface IStartCommandTerminalSessionRequest {
  annotation: IAnnotationSubmitDetail;
  actionId: string;
  displayName: string;
  kind: "command";
}

export interface IStartEditorTerminalSessionRequest {
  componentName: string;
  kind: "editor";
  launcher: EditorTerminalLauncher;
  source: ISourceLocation;
  sourceLabel: string;
}

export type StartTerminalSessionRequest =
  | IStartAgentTerminalSessionRequest
  | IStartCommandTerminalSessionRequest
  | IStartEditorTerminalSessionRequest;

export interface IStartTerminalSessionResponse {
  sessionId: string;
}

export interface IActiveTerminalSessionSnapshot {
  request: StartTerminalSessionRequest;
  sessionId: string;
}

export interface IListTerminalSessionsResponse {
  sessions: IActiveTerminalSessionSnapshot[];
}

export interface ITerminalSessionStartResult {
  errorMessage?: string;
  success: boolean;
}

interface ITerminalSessionBase {
  behavior: ITerminalSessionBehavior;
  errorMessage: string | null;
  isExpanded: boolean;
  sessionId: string;
  status: TerminalSessionStatus;
  summary: ITerminalSessionSummary;
}

export interface IAgentTerminalSession extends ITerminalSessionBase {
  actionId: string;
  annotation: IAnnotationSubmitDetail;
  displayName: string;
  kind: "agent";
}

export interface ICommandTerminalSession extends ITerminalSessionBase {
  actionId: string;
  annotation: IAnnotationSubmitDetail;
  displayName: string;
  kind: "command";
}

export interface IEditorTerminalSession extends ITerminalSessionBase {
  componentName: string;
  kind: "editor";
  launcher: EditorTerminalLauncher;
  sourceLabel: string;
}

export type TerminalSession = IAgentTerminalSession | ICommandTerminalSession | IEditorTerminalSession;

export interface ITerminalSessionInputMessage {
  data: string;
  type: "input";
}

export interface ITerminalSessionResizeMessage {
  cols: number;
  rows: number;
  type: "resize";
}

export interface ITerminalSessionCloseMessage {
  type: "close";
}

export type TerminalSessionClientMessage =
  | ITerminalSessionInputMessage
  | ITerminalSessionResizeMessage
  | ITerminalSessionCloseMessage;

export interface ITerminalSessionSnapshotMessage {
  data: string;
  type: "snapshot";
}

export interface ITerminalSessionOutputMessage {
  data: string;
  type: "output";
}

export interface ITerminalSessionExitMessage {
  exitCode: number | null;
  signalCode: string | null;
  type: "exit";
}

export interface ITerminalSessionErrorMessage {
  message: string;
  type: "error";
}

export type TerminalSessionServerMessage =
  | ITerminalSessionSnapshotMessage
  | ITerminalSessionOutputMessage
  | ITerminalSessionExitMessage
  | ITerminalSessionErrorMessage;
