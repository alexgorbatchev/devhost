export interface ISourceLocation {
  columnNumber?: number;
  componentName?: string;
  fileName: string;
  lineNumber: number;
}

export interface IRectSnapshot {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface IAnnotationSourceLocation extends ISourceLocation {}

export interface IAnnotationMarkerPayload {
  accessibility: string;
  boundingBox: IRectSnapshot;
  computedStyles: string;
  computedStylesObj: Record<string, string>;
  cssClasses: string;
  element: string;
  elementPath: string;
  fullPath: string;
  isFixed: boolean;
  markerNumber: number;
  nearbyElements: string;
  nearbyText: string;
  selectedText?: string;
  sourceLocation?: IAnnotationSourceLocation;
}

export interface IAnnotationSubmitDetail {
  comment: string;
  markers: IAnnotationMarkerPayload[];
  stackName: string;
  submittedAt: number;
  title: string;
  url: string;
}

export type AnnotationQueueStatus = "launching" | "working" | "paused";
export type AnnotationQueueEntryState = "active" | "paused-active" | "queued";
export type AnnotationQueuePauseReason = "session-exited-before-finished" | "user-terminated";

export interface IAnnotationQueueEntrySnapshot {
  annotation: IAnnotationSubmitDetail;
  createdAt: number;
  entryId: string;
  state: AnnotationQueueEntryState;
  updatedAt: number;
}

export interface IAnnotationQueueSnapshot {
  activeSessionId: string | null;
  entries: IAnnotationQueueEntrySnapshot[];
  pauseReason: AnnotationQueuePauseReason | null;
  queueId: string;
  status: AnnotationQueueStatus;
}

export type EditorTerminalLauncher = "neovim";

export interface IStartAgentTerminalSessionRequest {
  annotation: IAnnotationSubmitDetail;
  kind: "agent";
  targetSessionId?: string;
}

export interface IStartEditorTerminalSessionRequest {
  componentName: string;
  kind: "editor";
  launcher: EditorTerminalLauncher;
  source: ISourceLocation;
  sourceLabel: string;
}

export type StartTerminalSessionRequest = IStartAgentTerminalSessionRequest | IStartEditorTerminalSessionRequest;

export interface IActiveTerminalSessionSnapshot {
  request: StartTerminalSessionRequest;
  sessionId: string;
}

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

export type ServiceHealth = {
  name: string;
  status: boolean;
  url?: string;
};

export type HealthResponse = {
  services: ServiceHealth[];
};

export type ServiceLogStream = "stdout" | "stderr";

export type ServiceLogEntry = {
  id: number;
  line: string;
  serviceName: string;
  stream: ServiceLogStream;
};

export interface IRoutedServiceIdentity {
  host: string;
  path: string;
  serviceName: string;
}

export type DevtoolsComponentEditor = "neovim";
export type DevtoolsPosition = "top-right" | "bottom-right";

export interface IInjectedDevtoolsConfig {
  agentDisplayName: string;
  annotationEnabled: boolean;
  annotationQueueEnabled: boolean;
  componentEditor: DevtoolsComponentEditor;
  controlToken: string;
  editorEnabled: boolean;
  externalToolbarsEnabled: boolean;
  minimapEnabled: boolean;
  position: DevtoolsPosition;
  projectRootPath: string;
  routedServices: IRoutedServiceIdentity[];
  stackName: string;
  statusEnabled: boolean;
  terminalEnabled: boolean;
}
