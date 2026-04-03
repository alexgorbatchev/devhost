import type { ISourceLocation } from "../../shared/sourceLocation";
import type { IAnnotationSubmitDetail } from "../annotationComposer/types";

export interface IStartPiAnnotationSessionRequest {
  annotation: IAnnotationSubmitDetail;
  kind: "pi-annotation";
}

export interface IStartComponentSourceSessionRequest {
  componentName: string;
  kind: "component-source";
  source: ISourceLocation;
  sourceLabel: string;
}

export type IStartTerminalSessionRequest = IStartPiAnnotationSessionRequest | IStartComponentSourceSessionRequest;

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

export interface IPiAnnotationTerminalSession extends ITerminalSessionBase {
  annotation: IAnnotationSubmitDetail;
  kind: "pi-annotation";
}

export interface IComponentSourceTerminalSession extends ITerminalSessionBase {
  componentName: string;
  kind: "component-source";
  sourceLabel: string;
}

export type ITerminalSession = IPiAnnotationTerminalSession | IComponentSourceTerminalSession;

export interface IPiTerminalInputMessage {
  data: string;
  type: "input";
}

export interface IPiTerminalResizeMessage {
  cols: number;
  rows: number;
  type: "resize";
}

export interface IPiTerminalCloseMessage {
  type: "close";
}

export type PiTerminalClientMessage = IPiTerminalInputMessage | IPiTerminalResizeMessage | IPiTerminalCloseMessage;

export interface IPiTerminalSnapshotMessage {
  data: string;
  type: "snapshot";
}

export interface IPiTerminalOutputMessage {
  data: string;
  type: "output";
}

export interface IPiTerminalExitMessage {
  exitCode: number | null;
  signalCode: string | null;
  type: "exit";
}

export interface IPiTerminalErrorMessage {
  message: string;
  type: "error";
}

export type PiTerminalServerMessage =
  | IPiTerminalSnapshotMessage
  | IPiTerminalOutputMessage
  | IPiTerminalExitMessage
  | IPiTerminalErrorMessage;
