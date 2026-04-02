import type { IAnnotationSubmitDetail } from "../annotationComposer/types";

export interface IStartPiSessionRequest {
  annotation: IAnnotationSubmitDetail;
}

export interface IStartPiSessionResponse {
  sessionId: string;
}

export interface IAnnotationSubmitResult {
  errorMessage?: string;
  success: boolean;
}

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
