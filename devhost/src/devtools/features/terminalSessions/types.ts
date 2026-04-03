import type { ISourceLocation } from "../../shared/sourceLocation";
import type { IAnnotationSubmitDetail } from "../annotationComposer/types";

export interface IStartAnnotationTerminalSessionRequest {
  annotation: IAnnotationSubmitDetail;
  kind: "pi-annotation";
}

export interface IStartComponentSourceSessionRequest {
  componentName: string;
  kind: "component-source";
  source: ISourceLocation;
  sourceLabel: string;
}

export type IStartTerminalSessionRequest = IStartAnnotationTerminalSessionRequest | IStartComponentSourceSessionRequest;

export interface IStartTerminalSessionResponse {
  sessionId: string;
}

export interface ITerminalSessionStartResult {
  errorMessage?: string;
  success: boolean;
}

interface ITerminalSessionBase {
  isExpanded: boolean;
  sessionId: string;
}

export interface IAnnotationTerminalSession extends ITerminalSessionBase {
  annotation: IAnnotationSubmitDetail;
  kind: "pi-annotation";
}

export interface IComponentSourceTerminalSession extends ITerminalSessionBase {
  componentName: string;
  kind: "component-source";
  sourceLabel: string;
}

export type ITerminalSession = IAnnotationTerminalSession | IComponentSourceTerminalSession;

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
