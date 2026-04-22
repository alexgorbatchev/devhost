import type { ILocationHostProtocol } from "../../shared/types";
import { createDevtoolsWebSocketUrl } from "../../shared/createDevtoolsWebSocketUrl";
import {
  ANNOTATION_QUEUES_PATH,
  ANNOTATION_QUEUES_WEBSOCKET_PATH,
  DEVTOOLS_CONTROL_TOKEN_HEADER_NAME,
  DEVTOOLS_CONTROL_TOKEN_QUERY_PARAMETER_NAME,
} from "../../shared/constants";
import type {
  IAnnotationQueueServerMessage,
  IAnnotationQueueSnapshot,
  IAnnotationQueuesSnapshotMessage,
  IResumeAnnotationQueueResponse,
} from "./types";

export type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function createAnnotationQueuesWebSocketUrl(location: ILocationHostProtocol, controlToken: string): string {
  const websocketUrl = new URL(createDevtoolsWebSocketUrl(ANNOTATION_QUEUES_WEBSOCKET_PATH, location));

  websocketUrl.searchParams.set(DEVTOOLS_CONTROL_TOKEN_QUERY_PARAMETER_NAME, controlToken);

  return websocketUrl.toString();
}

export function parseAnnotationQueuesServerMessage(messageText: string): IAnnotationQueueServerMessage | null {
  try {
    const value: unknown = JSON.parse(messageText);

    return isAnnotationQueuesSnapshotMessage(value) ? value : null;
  } catch {
    return null;
  }
}

export async function updateAnnotationQueueEntry(
  entryId: string,
  comment: string,
  fetchImplementation: FetchImplementation,
  controlToken: string,
): Promise<void> {
  await expectSuccessfulMutationResponse(
    `${ANNOTATION_QUEUES_PATH}/${encodeURIComponent(entryId)}`,
    {
      body: JSON.stringify({ comment }),
      headers: {
        "content-type": "application/json",
        [DEVTOOLS_CONTROL_TOKEN_HEADER_NAME]: controlToken,
      },
      method: "PATCH",
    },
    fetchImplementation,
  );
}

export async function deleteAnnotationQueueEntry(
  entryId: string,
  fetchImplementation: FetchImplementation,
  controlToken: string,
): Promise<void> {
  await expectSuccessfulMutationResponse(
    `${ANNOTATION_QUEUES_PATH}/${encodeURIComponent(entryId)}`,
    {
      headers: {
        [DEVTOOLS_CONTROL_TOKEN_HEADER_NAME]: controlToken,
      },
      method: "DELETE",
    },
    fetchImplementation,
  );
}

export async function resumeAnnotationQueue(
  queueId: string,
  fetchImplementation: FetchImplementation,
  controlToken: string,
): Promise<IResumeAnnotationQueueResponse> {
  const response = await fetchImplementation(`${ANNOTATION_QUEUES_PATH}/${encodeURIComponent(queueId)}/resume`, {
    headers: {
      [DEVTOOLS_CONTROL_TOKEN_HEADER_NAME]: controlToken,
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const responseBody: unknown = await response.json();

  if (!isResumeAnnotationQueueResponse(responseBody)) {
    throw new Error("Annotation queue resume returned an invalid response.");
  }

  return responseBody;
}

async function expectSuccessfulMutationResponse(
  path: string,
  requestInit: RequestInit,
  fetchImplementation: FetchImplementation,
): Promise<void> {
  const response = await fetchImplementation(path, requestInit);

  if (!response.ok) {
    throw new Error(await response.text());
  }
}

function isAnnotationQueuesSnapshotMessage(value: unknown): value is IAnnotationQueuesSnapshotMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return Reflect.get(value, "type") === "snapshot" && isAnnotationQueueSnapshots(Reflect.get(value, "queues"));
}

function isAnnotationQueueSnapshots(value: unknown): value is IAnnotationQueueSnapshot[] {
  return Array.isArray(value) && value.every((entry: unknown): boolean => isAnnotationQueueSnapshot(entry));
}

function isAnnotationQueueSnapshot(value: unknown): value is IAnnotationQueueSnapshot {
  return (
    typeof value === "object" &&
    value !== null &&
    (Reflect.get(value, "activeSessionId") === null || typeof Reflect.get(value, "activeSessionId") === "string") &&
    Array.isArray(Reflect.get(value, "entries")) &&
    Reflect.get(value, "entries").every((entry: unknown): boolean => isAnnotationQueueEntrySnapshot(entry)) &&
    isAnnotationQueuePauseReason(Reflect.get(value, "pauseReason")) &&
    typeof Reflect.get(value, "queueId") === "string" &&
    isAnnotationQueueStatus(Reflect.get(value, "status"))
  );
}

function isAnnotationQueueEntrySnapshot(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "createdAt") === "number" &&
    typeof Reflect.get(value, "entryId") === "string" &&
    isAnnotationSubmitDetail(Reflect.get(value, "annotation")) &&
    isAnnotationQueueEntryState(Reflect.get(value, "state")) &&
    typeof Reflect.get(value, "updatedAt") === "number"
  );
}

function isAnnotationQueueEntryState(value: unknown): boolean {
  return value === "active" || value === "paused-active" || value === "queued";
}

function isAnnotationQueuePauseReason(value: unknown): boolean {
  return value === null || value === "session-exited-before-finished" || value === "user-terminated";
}

function isAnnotationQueueStatus(value: unknown): boolean {
  return value === "launching" || value === "working" || value === "paused";
}

function isResumeAnnotationQueueResponse(value: unknown): value is IResumeAnnotationQueueResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    Reflect.get(value, "success") === true &&
    typeof Reflect.get(value, "sessionId") === "string"
  );
}

function isAnnotationSubmitDetail(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "comment") === "string" &&
    Array.isArray(Reflect.get(value, "markers")) &&
    typeof Reflect.get(value, "stackName") === "string" &&
    typeof Reflect.get(value, "submittedAt") === "number" &&
    typeof Reflect.get(value, "title") === "string" &&
    typeof Reflect.get(value, "url") === "string"
  );
}
