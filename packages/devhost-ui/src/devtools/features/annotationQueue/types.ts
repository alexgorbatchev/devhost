import type { IAnnotationSubmitDetail } from "../annotationComposer/types";

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

export interface IListAnnotationQueuesResponse {
  queues: IAnnotationQueueSnapshot[];
}

export interface IUpdateAnnotationQueueEntryRequest {
  comment: string;
}

export interface IAnnotationQueueMutationResponse {
  success: true;
}

export interface IResumeAnnotationQueueResponse {
  sessionId: string;
  success: true;
}

export interface IAnnotationQueuesSnapshotMessage {
  queues: IAnnotationQueueSnapshot[];
  type: "snapshot";
}

export interface IAnnotationQueueServerMessage extends IAnnotationQueuesSnapshotMessage {}
