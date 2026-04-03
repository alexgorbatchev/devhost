import type { ISourceLocation } from "../../shared/sourceLocation";
import type { IAnnotationSubmitDetail } from "../annotationComposer/types";

export interface ITerminalSessionBehavior {
  defaultIsExpanded: boolean;
  isFullscreenExpanded: boolean;
  shouldAutoRemoveOnExit: boolean;
}

export interface ITerminalSessionSummary {
  eyebrow: string;
  headline: string;
  meta: string[];
  terminalTitle: string;
  trayTooltipPrimary: string;
  trayTooltipSecondary?: string;
}

export type AgentTerminalLauncher = "pi";
export type EditorTerminalLauncher = "neovim";

export interface IStartAgentTerminalSessionRequest {
  annotation: IAnnotationSubmitDetail;
  kind: "agent";
  launcher: AgentTerminalLauncher;
}

export interface IStartEditorTerminalSessionRequest {
  componentName: string;
  kind: "editor";
  launcher: EditorTerminalLauncher;
  source: ISourceLocation;
  sourceLabel: string;
}

export type IStartTerminalSessionRequest = IStartAgentTerminalSessionRequest | IStartEditorTerminalSessionRequest;

export interface IStartTerminalSessionResponse {
  sessionId: string;
}

export interface ITerminalSessionStartResult {
  errorMessage?: string;
  success: boolean;
}

interface ITerminalSessionBase {
  behavior: ITerminalSessionBehavior;
  isExpanded: boolean;
  sessionId: string;
  summary: ITerminalSessionSummary;
}

export interface IAgentTerminalSession extends ITerminalSessionBase {
  annotation: IAnnotationSubmitDetail;
  kind: "agent";
  launcher: AgentTerminalLauncher;
}

export interface IEditorTerminalSession extends ITerminalSessionBase {
  componentName: string;
  kind: "editor";
  launcher: EditorTerminalLauncher;
  sourceLabel: string;
}

export type ITerminalSession = IAgentTerminalSession | IEditorTerminalSession;

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

export type TerminalSessionClientMessage = ITerminalSessionInputMessage | ITerminalSessionResizeMessage | ITerminalSessionCloseMessage;

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
