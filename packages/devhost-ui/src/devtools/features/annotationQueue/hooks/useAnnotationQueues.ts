import { useCallback, useEffect, useState } from "react";

import { readInjectedDevtoolsConfig } from "../../../shared/readInjectedDevtoolsConfig";
import {
  createAnnotationQueuesWebSocketUrl,
  deleteAnnotationQueueEntry,
  parseAnnotationQueuesServerMessage,
  resumeAnnotationQueue,
  updateAnnotationQueueEntry,
} from "../client";
import type { IAnnotationQueueSnapshot } from "../types";

const normalClosureCode: number = 1_000;

interface IUseAnnotationQueuesResult {
  errorMessage: string | null;
  isEntryMutationPending: (entryId: string) => boolean;
  isQueueResumePending: (queueId: string) => boolean;
  queues: IAnnotationQueueSnapshot[];
  removeEntry: (entryId: string) => Promise<boolean>;
  resumeQueue: (queueId: string) => Promise<string | null>;
  saveEntry: (entryId: string, comment: string) => Promise<boolean>;
}

export function useAnnotationQueues(enabled: boolean = true): IUseAnnotationQueuesResult {
  const { controlToken } = readInjectedDevtoolsConfig();
  const [entryMutationIds, setEntryMutationIds] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [queueResumeIds, setQueueResumeIds] = useState<string[]>([]);
  const [queues, setQueues] = useState<IAnnotationQueueSnapshot[]>([]);

  useEffect(() => {
    if (!enabled) {
      setQueues([]);
      setErrorMessage(null);
      return;
    }

    let isDisposed: boolean = false;
    const websocket = new WebSocket(createAnnotationQueuesWebSocketUrl(window.location, controlToken));

    const handleOpen = (): void => {
      setErrorMessage(null);
    };
    const handleMessage = (event: MessageEvent): void => {
      if (typeof event.data !== "string") {
        setErrorMessage("devhost annotation queue stream sent a non-text message.");
        return;
      }

      const serverMessage = parseAnnotationQueuesServerMessage(event.data);

      if (serverMessage === null) {
        setErrorMessage("devhost annotation queue stream sent malformed data.");
        return;
      }

      setQueues(serverMessage.queues);
      setErrorMessage(null);
    };
    const handleClose = (event: CloseEvent): void => {
      if (isDisposed || event.code === normalClosureCode) {
        return;
      }

      setErrorMessage("devhost annotation queue stream disconnected.");
    };

    websocket.addEventListener("open", handleOpen);
    websocket.addEventListener("message", handleMessage);
    websocket.addEventListener("close", handleClose);

    return () => {
      isDisposed = true;
      websocket.close(normalClosureCode, "devtools unmounted");
    };
  }, [controlToken, enabled]);

  const saveEntry = useCallback(
    async (entryId: string, comment: string): Promise<boolean> => {
      if (!enabled) {
        return false;
      }

      return await runEntryMutation(entryId, setEntryMutationIds, setErrorMessage, async (): Promise<boolean> => {
        await updateAnnotationQueueEntry(entryId, comment, fetch, controlToken);
        return true;
      });
    },
    [controlToken, enabled],
  );

  const removeEntry = useCallback(
    async (entryId: string): Promise<boolean> => {
      if (!enabled) {
        return false;
      }

      return await runEntryMutation(entryId, setEntryMutationIds, setErrorMessage, async (): Promise<boolean> => {
        await deleteAnnotationQueueEntry(entryId, fetch, controlToken);
        return true;
      });
    },
    [controlToken, enabled],
  );

  const resumeQueue = useCallback(
    async (queueId: string): Promise<string | null> => {
      if (!enabled) {
        return null;
      }

      setQueueResumeIds((currentIds: string[]): string[] => appendPendingId(currentIds, queueId));

      try {
        const response = await resumeAnnotationQueue(queueId, fetch, controlToken);

        setErrorMessage(null);
        return response.sessionId;
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error));
        return null;
      } finally {
        setQueueResumeIds((currentIds: string[]): string[] => removePendingId(currentIds, queueId));
      }
    },
    [controlToken, enabled],
  );

  return {
    errorMessage,
    isEntryMutationPending: (entryId: string): boolean => entryMutationIds.includes(entryId),
    isQueueResumePending: (queueId: string): boolean => queueResumeIds.includes(queueId),
    queues,
    removeEntry,
    resumeQueue,
    saveEntry,
  };
}

type SetPendingIds = (value: (currentIds: string[]) => string[]) => void;
type SetErrorMessage = (value: string | null) => void;
type QueueEntryMutation = () => Promise<boolean>;

async function runEntryMutation(
  entryId: string,
  setEntryMutationIds: SetPendingIds,
  setErrorMessage: SetErrorMessage,
  operation: QueueEntryMutation,
): Promise<boolean> {
  setEntryMutationIds((currentIds: string[]): string[] => appendPendingId(currentIds, entryId));

  try {
    const didSucceed: boolean = await operation();

    setErrorMessage(null);
    return didSucceed;
  } catch (error) {
    setErrorMessage(error instanceof Error ? error.message : String(error));
    return false;
  } finally {
    setEntryMutationIds((currentIds: string[]): string[] => removePendingId(currentIds, entryId));
  }
}

function appendPendingId(currentIds: string[], id: string): string[] {
  return currentIds.includes(id) ? currentIds : [...currentIds, id];
}

function removePendingId(currentIds: string[], id: string): string[] {
  return currentIds.filter((currentId: string): boolean => currentId !== id);
}
