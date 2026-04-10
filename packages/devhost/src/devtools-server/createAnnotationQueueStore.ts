import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

import type {
  AnnotationQueuePauseReason,
  AnnotationQueueStatus,
  IAnnotationQueueEntrySnapshot,
  IAnnotationQueueSnapshot,
} from "../devtools/features/annotationQueue/types";
import type { IAnnotationMarkerPayload, IAnnotationSubmitDetail } from "../devtools/features/annotationComposer/types";
import { resolveRoutedServiceKeyForUrl, type IRoutedServiceIdentity } from "../devtools/shared/routedServices";
import type { IDevhostLogger } from "../utils/createLogger";

export class AnnotationQueueConflictError extends Error {}
export class AnnotationQueueNotFoundError extends Error {}
export class AnnotationQueueValidationError extends Error {}

export type AgentSessionStatus = "working" | "finished";

type PersistedAnnotationQueuePauseReason = "session-exited-before-finished" | "shutdown" | "user-terminated" | null;

interface IPersistedAnnotationQueueEntry {
  annotation: IAnnotationSubmitDetail;
  createdAt: number;
  entryId: string;
  updatedAt: number;
}

interface IPersistedAnnotationQueueRecord {
  currentEntry: IPersistedAnnotationQueueEntry;
  pauseReason: PersistedAnnotationQueuePauseReason;
  pendingEntries: IPersistedAnnotationQueueEntry[];
  queueId: string;
}

interface IPersistedAnnotationQueueState {
  queues: IPersistedAnnotationQueueRecord[];
  version: 1;
}

interface IRuntimeAnnotationQueueRecord extends IPersistedAnnotationQueueRecord {
  activeSessionId: string | null;
  status: AnnotationQueueStatus;
}

interface ILiveAgentSessionSnapshot {
  agentStatus: AgentSessionStatus | null;
  annotation: IAnnotationSubmitDetail;
  sessionId: string;
}

interface IQueueSessionResult {
  sessionId: string;
}

interface IPersistedQueueStateShape {
  queues: unknown[];
  version: 1;
}

type OnQueuesChanged = (queues: IAnnotationQueueSnapshot[]) => void;
type ReadLiveAgentSession = (sessionId: string) => ILiveAgentSessionSnapshot | null;
type StartAgentSession = (annotation: IAnnotationSubmitDetail) => string;
type WriteAnnotationToSession = (sessionId: string, annotation: IAnnotationSubmitDetail) => void;
type SerializedMutationOperation<T> = () => Promise<T>;
type RuntimeQueueEntry = [string, IRuntimeAnnotationQueueRecord];

interface ICreateAnnotationQueueStoreOptions {
  logger: IDevhostLogger;
  manifestPath: string;
  onQueuesChanged?: OnQueuesChanged;
  readLiveAgentSession: ReadLiveAgentSession;
  routedServices?: IRoutedServiceIdentity[];
  stackName: string;
  startAgentSession: StartAgentSession;
  stateDirectoryPath: string;
  writeAnnotationToSession: WriteAnnotationToSession;
}

interface IAnnotationQueueStore {
  deleteEntry: (entryId: string) => Promise<void>;
  enqueue: (annotation: IAnnotationSubmitDetail, targetSessionId?: string) => Promise<IQueueSessionResult>;
  getSnapshot: () => IAnnotationQueueSnapshot[];
  handleAgentStatus: (sessionId: string, status: AgentSessionStatus) => Promise<void>;
  handleSessionExited: (sessionId: string) => Promise<void>;
  handleUserClosedSession: (sessionId: string) => Promise<void>;
  prepareForShutdown: () => Promise<void>;
  resumePersistedQueues: () => Promise<void>;
  resumeQueue: (queueId: string) => Promise<IQueueSessionResult>;
  updateEntryComment: (entryId: string, comment: string) => Promise<void>;
}

const annotationQueuesDirectoryName: string = "annotation-queues";
const annotationQueuesVersion = 1 as const;
const queueStateDirectoryMode: number = 0o700;
const queueStateFileMode: number = 0o600;

export function createAnnotationQueueStore(options: ICreateAnnotationQueueStoreOptions): IAnnotationQueueStore {
  const queueFilePath: string = createAnnotationQueueFilePath(
    options.stateDirectoryPath,
    options.stackName,
    options.manifestPath,
  );
  const persistedState = loadPersistedAnnotationQueueState(queueFilePath, options.logger);
  const routedServices: IRoutedServiceIdentity[] = options.routedServices ?? [];
  const runtimeQueues: Map<string, IRuntimeAnnotationQueueRecord> = new Map(
    persistedState.queues.map((queue): RuntimeQueueEntry => {
      return [
        queue.queueId,
        {
          ...queue,
          activeSessionId: null,
          status: "paused",
        },
      ];
    }),
  );
  let mutationChain: Promise<void> = Promise.resolve();

  return {
    deleteEntry: async (entryId: string): Promise<void> => {
      await runSerializedMutation(async (): Promise<void> => {
        const locatedEntry = locateQueueEntry(runtimeQueues, entryId);

        if (locatedEntry === null) {
          throw new AnnotationQueueNotFoundError("Queue entry was not found.");
        }

        if (locatedEntry.entryState === "active") {
          throw new AnnotationQueueConflictError("Active queue entries cannot be removed.");
        }

        const queue: IRuntimeAnnotationQueueRecord = locatedEntry.queue;

        if (locatedEntry.entryState === "queued") {
          queue.pendingEntries.splice(locatedEntry.pendingIndex, 1);
        } else if (queue.pendingEntries.length > 0) {
          const nextEntry: IPersistedAnnotationQueueEntry | undefined = queue.pendingEntries.shift();

          if (nextEntry === undefined) {
            runtimeQueues.delete(queue.queueId);
          } else {
            queue.currentEntry = nextEntry;
          }
        } else {
          runtimeQueues.delete(queue.queueId);
        }

        persistRuntimeQueues(queueFilePath, runtimeQueues);
        publishQueuesChanged(options.onQueuesChanged, runtimeQueues);
      });
    },
    enqueue: async (annotation: IAnnotationSubmitDetail, targetSessionId?: string): Promise<IQueueSessionResult> => {
      if (!isAnnotationSubmitDetail(annotation)) {
        throw new AnnotationQueueValidationError("Invalid annotation payload.");
      }

      return await runSerializedMutation(async (): Promise<IQueueSessionResult> => {
        const targetLiveSession = targetSessionId === undefined ? null : options.readLiveAgentSession(targetSessionId);
        const annotationServiceKey: string | null = readAnnotationServiceKey(annotation, routedServices);
        const shouldUseTargetSession: boolean = shouldUseLiveTargetSession(
          annotationServiceKey,
          targetLiveSession,
          routedServices,
        );
        const targetQueue =
          targetSessionId !== undefined && shouldUseTargetSession ? findQueueBySessionId(runtimeQueues, targetSessionId) : null;

        if (targetQueue !== null) {
          return await enqueueIntoExistingQueue(targetQueue, annotation, Date.now(), runtimeQueues, queueFilePath, options);
        }

        const serviceQueue =
          annotationServiceKey === null ? null : findQueueByServiceKey(runtimeQueues, routedServices, annotationServiceKey);

        if (serviceQueue !== null) {
          return await enqueueIntoExistingQueue(serviceQueue, annotation, Date.now(), runtimeQueues, queueFilePath, options);
        }

        const liveTargetSession = shouldUseTargetSession ? targetLiveSession : null;
        const timestamp: number = Date.now();
        const queue = createRuntimeQueueForEnqueue(annotation, timestamp, liveTargetSession);

        runtimeQueues.set(queue.queueId, queue);
        persistRuntimeQueues(queueFilePath, runtimeQueues);

        try {
          const sessionId: string = await dispatchQueueHead(
            queue,
            runtimeQueues,
            queueFilePath,
            options,
            liveTargetSession,
          );

          publishQueuesChanged(options.onQueuesChanged, runtimeQueues);
          return { sessionId };
        } catch (error) {
          queue.activeSessionId = null;
          queue.pauseReason = "session-exited-before-finished";
          queue.status = "paused";
          persistRuntimeQueues(queueFilePath, runtimeQueues);
          publishQueuesChanged(options.onQueuesChanged, runtimeQueues);
          throw error;
        }
      });
    },
    getSnapshot: (): IAnnotationQueueSnapshot[] => {
      return createQueueSnapshots(runtimeQueues);
    },
    handleAgentStatus: async (sessionId: string, status: AgentSessionStatus): Promise<void> => {
      await runSerializedMutation(async (): Promise<void> => {
        const queue = findQueueBySessionId(runtimeQueues, sessionId);

        if (queue === null) {
          return;
        }

        if (status === "working") {
          if (queue.status !== "working") {
            queue.status = "working";
            persistRuntimeQueues(queueFilePath, runtimeQueues);
            publishQueuesChanged(options.onQueuesChanged, runtimeQueues);
          }

          return;
        }

        if (queue.pendingEntries.length === 0) {
          runtimeQueues.delete(queue.queueId);
          persistRuntimeQueues(queueFilePath, runtimeQueues);
          publishQueuesChanged(options.onQueuesChanged, runtimeQueues);
          return;
        }

        const nextEntry: IPersistedAnnotationQueueEntry | undefined = queue.pendingEntries.shift();

        if (nextEntry === undefined) {
          runtimeQueues.delete(queue.queueId);
          persistRuntimeQueues(queueFilePath, runtimeQueues);
          publishQueuesChanged(options.onQueuesChanged, runtimeQueues);
          return;
        }

        queue.currentEntry = nextEntry;
        queue.pauseReason = null;
        persistRuntimeQueues(queueFilePath, runtimeQueues);

        try {
          await dispatchQueueHead(
            queue,
            runtimeQueues,
            queueFilePath,
            options,
            options.readLiveAgentSession(sessionId),
          );
          publishQueuesChanged(options.onQueuesChanged, runtimeQueues);
        } catch (error) {
          queue.activeSessionId = null;
          queue.pauseReason = "session-exited-before-finished";
          queue.status = "paused";
          persistRuntimeQueues(queueFilePath, runtimeQueues);
          publishQueuesChanged(options.onQueuesChanged, runtimeQueues);
          throw error;
        }
      });
    },
    handleSessionExited: async (sessionId: string): Promise<void> => {
      await runSerializedMutation(async (): Promise<void> => {
        pauseQueueForSession(
          runtimeQueues,
          queueFilePath,
          options.onQueuesChanged,
          sessionId,
          "session-exited-before-finished",
        );
      });
    },
    handleUserClosedSession: async (sessionId: string): Promise<void> => {
      await runSerializedMutation(async (): Promise<void> => {
        pauseQueueForSession(runtimeQueues, queueFilePath, options.onQueuesChanged, sessionId, "user-terminated");
      });
    },
    prepareForShutdown: async (): Promise<void> => {
      await runSerializedMutation(async (): Promise<void> => {
        let hasChanges: boolean = false;

        for (const queue of runtimeQueues.values()) {
          if (queue.activeSessionId === null) {
            continue;
          }

          queue.activeSessionId = null;
          queue.pauseReason = "shutdown";
          queue.status = "paused";
          hasChanges = true;
        }

        if (hasChanges) {
          persistRuntimeQueues(queueFilePath, runtimeQueues);
        }
      });
    },
    resumePersistedQueues: async (): Promise<void> => {
      for (const queue of runtimeQueues.values()) {
        if (queue.pauseReason === "user-terminated") {
          continue;
        }

        await runSerializedMutation(async (): Promise<void> => {
          const activeQueue = runtimeQueues.get(queue.queueId);

          if (activeQueue === undefined || activeQueue.pauseReason === "user-terminated") {
            return;
          }

          const previousPauseReason: PersistedAnnotationQueuePauseReason = activeQueue.pauseReason;

          activeQueue.pauseReason = null;
          persistRuntimeQueues(queueFilePath, runtimeQueues);

          try {
            await dispatchQueueHead(activeQueue, runtimeQueues, queueFilePath, options, null);
            publishQueuesChanged(options.onQueuesChanged, runtimeQueues);
          } catch (error) {
            activeQueue.activeSessionId = null;
            activeQueue.pauseReason = previousPauseReason ?? "session-exited-before-finished";
            activeQueue.status = "paused";
            persistRuntimeQueues(queueFilePath, runtimeQueues);
            publishQueuesChanged(options.onQueuesChanged, runtimeQueues);
            throw error;
          }
        });
      }
    },
    resumeQueue: async (queueId: string): Promise<IQueueSessionResult> => {
      return await runSerializedMutation(async (): Promise<IQueueSessionResult> => {
        const queue = runtimeQueues.get(queueId);

        if (queue === undefined) {
          throw new AnnotationQueueNotFoundError("Queue was not found.");
        }

        if (queue.status !== "paused") {
          throw new AnnotationQueueConflictError("Queue is not paused.");
        }

        const previousPauseReason: PersistedAnnotationQueuePauseReason = queue.pauseReason;

        queue.pauseReason = null;
        persistRuntimeQueues(queueFilePath, runtimeQueues);

        try {
          const sessionId: string = await dispatchQueueHead(queue, runtimeQueues, queueFilePath, options, null);

          publishQueuesChanged(options.onQueuesChanged, runtimeQueues);
          return { sessionId };
        } catch (error) {
          queue.activeSessionId = null;
          queue.pauseReason = previousPauseReason;
          queue.status = "paused";
          persistRuntimeQueues(queueFilePath, runtimeQueues);
          publishQueuesChanged(options.onQueuesChanged, runtimeQueues);
          throw error;
        }
      });
    },
    updateEntryComment: async (entryId: string, comment: string): Promise<void> => {
      if (comment.trim().length === 0) {
        throw new AnnotationQueueValidationError("Queue entry comments must not be blank.");
      }

      await runSerializedMutation(async (): Promise<void> => {
        const locatedEntry = locateQueueEntry(runtimeQueues, entryId);

        if (locatedEntry === null) {
          throw new AnnotationQueueNotFoundError("Queue entry was not found.");
        }

        if (locatedEntry.entryState === "active") {
          throw new AnnotationQueueConflictError("Active queue entries cannot be edited.");
        }

        locatedEntry.entry.annotation = {
          ...locatedEntry.entry.annotation,
          comment,
        };
        locatedEntry.entry.updatedAt = Date.now();

        persistRuntimeQueues(queueFilePath, runtimeQueues);
        publishQueuesChanged(options.onQueuesChanged, runtimeQueues);
      });
    },
  };

  function runSerializedMutation<T>(operation: SerializedMutationOperation<T>): Promise<T> {
    const result: Promise<T> = mutationChain.then(operation, operation);

    mutationChain = result.then(
      (): void => {},
      (): void => {},
    );

    return result;
  }
}

interface ILocatedQueueEntry {
  entry: IPersistedAnnotationQueueEntry;
  entryState: "active" | "paused-active" | "queued";
  pendingIndex: number;
  queue: IRuntimeAnnotationQueueRecord;
}

function createAnnotationQueueFilePath(stateDirectoryPath: string, stackName: string, manifestPath: string): string {
  const fileName: string = `${sanitizeFileSegment(stackName)}-${createHash("sha256").update(manifestPath).digest("hex").slice(0, 12)}.json`;

  return join(stateDirectoryPath, "devtools", annotationQueuesDirectoryName, fileName);
}

function sanitizeFileSegment(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9._-]/g, "-");
}

function loadPersistedAnnotationQueueState(
  queueFilePath: string,
  logger: IDevhostLogger,
): IPersistedAnnotationQueueState {
  if (!existsSync(queueFilePath)) {
    return createEmptyPersistedQueueState();
  }

  let parsedValue: unknown;

  try {
    parsedValue = JSON.parse(readFileSync(queueFilePath, "utf8"));
  } catch (error) {
    moveCorruptQueueFile(queueFilePath, logger, error instanceof Error ? error.message : String(error));
    return createEmptyPersistedQueueState();
  }

  if (!isPersistedQueueStateShape(parsedValue)) {
    moveCorruptQueueFile(queueFilePath, logger, "Invalid top-level queue state shape.");
    return createEmptyPersistedQueueState();
  }

  return {
    queues: parsedValue.queues.flatMap((queue): IPersistedAnnotationQueueRecord[] => {
      const repairedQueue = repairPersistedQueueRecord(queue);

      return repairedQueue === null ? [] : [repairedQueue];
    }),
    version: annotationQueuesVersion,
  };
}

function moveCorruptQueueFile(queueFilePath: string, logger: IDevhostLogger, reason: string): void {
  try {
    const directoryPath: string = dirname(queueFilePath);
    const corruptFilePath: string = join(
      directoryPath,
      `${basename(queueFilePath, ".json")}.corrupt-${Date.now()}.json`,
    );

    renameSync(queueFilePath, corruptFilePath);
  } catch {
    // Best effort. Logging still happens below.
  }

  logger.error(`Annotation queue state at ${queueFilePath} was corrupt and has been reset. ${reason}`);
}

function createEmptyPersistedQueueState(): IPersistedAnnotationQueueState {
  return {
    queues: [],
    version: annotationQueuesVersion,
  };
}

function isPersistedQueueStateShape(value: unknown): value is IPersistedQueueStateShape {
  return (
    typeof value === "object" &&
    value !== null &&
    Reflect.get(value, "version") === annotationQueuesVersion &&
    Array.isArray(Reflect.get(value, "queues"))
  );
}

function repairPersistedQueueRecord(value: unknown): IPersistedAnnotationQueueRecord | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const queueId: unknown = Reflect.get(value, "queueId");
  const pauseReason: unknown = Reflect.get(value, "pauseReason");
  const currentEntryValue: unknown = Reflect.get(value, "currentEntry");
  const pendingEntriesValue: unknown = Reflect.get(value, "pendingEntries");

  if (typeof queueId !== "string" || !isPersistedPauseReason(pauseReason) || !Array.isArray(pendingEntriesValue)) {
    return null;
  }

  const repairedPendingEntries: IPersistedAnnotationQueueEntry[] = pendingEntriesValue.flatMap(
    (entry): IPersistedAnnotationQueueEntry[] => {
      const repairedEntry = repairPersistedQueueEntry(entry);

      return repairedEntry === null ? [] : [repairedEntry];
    },
  );
  const repairedCurrentEntry: IPersistedAnnotationQueueEntry | null = repairPersistedQueueEntry(currentEntryValue);

  if (repairedCurrentEntry !== null) {
    return {
      currentEntry: repairedCurrentEntry,
      pauseReason,
      pendingEntries: repairedPendingEntries,
      queueId,
    };
  }

  const nextCurrentEntry: IPersistedAnnotationQueueEntry | undefined = repairedPendingEntries.shift();

  if (nextCurrentEntry === undefined) {
    return null;
  }

  return {
    currentEntry: nextCurrentEntry,
    pauseReason,
    pendingEntries: repairedPendingEntries,
    queueId,
  };
}

function repairPersistedQueueEntry(value: unknown): IPersistedAnnotationQueueEntry | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const annotation: unknown = Reflect.get(value, "annotation");
  const createdAt: unknown = Reflect.get(value, "createdAt");
  const entryId: unknown = Reflect.get(value, "entryId");
  const updatedAt: unknown = Reflect.get(value, "updatedAt");

  if (
    !isAnnotationSubmitDetail(annotation) ||
    typeof createdAt !== "number" ||
    Number.isNaN(createdAt) ||
    typeof entryId !== "string" ||
    typeof updatedAt !== "number" ||
    Number.isNaN(updatedAt)
  ) {
    return null;
  }

  return {
    annotation,
    createdAt,
    entryId,
    updatedAt,
  };
}

function isPersistedPauseReason(value: unknown): value is PersistedAnnotationQueuePauseReason {
  return (
    value === null || value === "session-exited-before-finished" || value === "shutdown" || value === "user-terminated"
  );
}

function persistRuntimeQueues(queueFilePath: string, runtimeQueues: Map<string, IRuntimeAnnotationQueueRecord>): void {
  if (runtimeQueues.size === 0) {
    if (existsSync(queueFilePath)) {
      unlinkSync(queueFilePath);
    }

    return;
  }

  const persistedState: IPersistedAnnotationQueueState = {
    queues: [...runtimeQueues.values()].map((queue): IPersistedAnnotationQueueRecord => {
      return {
        currentEntry: queue.currentEntry,
        pauseReason: queue.pauseReason,
        pendingEntries: queue.pendingEntries,
        queueId: queue.queueId,
      };
    }),
    version: annotationQueuesVersion,
  };
  const directoryPath: string = dirname(queueFilePath);

  mkdirSync(directoryPath, {
    mode: queueStateDirectoryMode,
    recursive: true,
  });

  const jsonText: string = JSON.stringify(persistedState, null, 2);
  const temporaryPath: string = `${queueFilePath}.${crypto.randomUUID()}.tmp`;
  const fileDescriptor: number = openSync(temporaryPath, "w", queueStateFileMode);

  try {
    writeSync(fileDescriptor, jsonText);
    fsyncSync(fileDescriptor);
  } finally {
    closeSync(fileDescriptor);
  }

  renameSync(temporaryPath, queueFilePath);
}

async function dispatchQueueHead(
  queue: IRuntimeAnnotationQueueRecord,
  runtimeQueues: Map<string, IRuntimeAnnotationQueueRecord>,
  queueFilePath: string,
  options: ICreateAnnotationQueueStoreOptions,
  preferredSession: ILiveAgentSessionSnapshot | null,
): Promise<string> {
  queue.pauseReason = null;
  queue.status = "launching";
  persistRuntimeQueues(queueFilePath, runtimeQueues);

  const activeSession = readDispatchTargetSession(
    queue.activeSessionId,
    preferredSession,
    options.readLiveAgentSession,
  );

  if (activeSession !== null) {
    options.writeAnnotationToSession(activeSession.sessionId, queue.currentEntry.annotation);
    queue.activeSessionId = activeSession.sessionId;
    return activeSession.sessionId;
  }

  const sessionId: string = options.startAgentSession(queue.currentEntry.annotation);

  queue.activeSessionId = sessionId;
  return sessionId;
}

async function enqueueIntoExistingQueue(
  queue: IRuntimeAnnotationQueueRecord,
  annotation: IAnnotationSubmitDetail,
  timestamp: number,
  runtimeQueues: Map<string, IRuntimeAnnotationQueueRecord>,
  queueFilePath: string,
  options: ICreateAnnotationQueueStoreOptions,
): Promise<IQueueSessionResult> {
  queue.pendingEntries.push(createPersistedQueueEntry(annotation, timestamp));
  persistRuntimeQueues(queueFilePath, runtimeQueues);

  if (queue.status !== "paused" && queue.activeSessionId !== null) {
    publishQueuesChanged(options.onQueuesChanged, runtimeQueues);
    return {
      sessionId: queue.activeSessionId,
    };
  }

  const previousPauseReason: PersistedAnnotationQueuePauseReason = queue.pauseReason;

  try {
    const sessionId: string = await dispatchQueueHead(queue, runtimeQueues, queueFilePath, options, null);

    publishQueuesChanged(options.onQueuesChanged, runtimeQueues);
    return { sessionId };
  } catch (error) {
    queue.activeSessionId = null;
    queue.pauseReason = previousPauseReason ?? "session-exited-before-finished";
    queue.status = "paused";
    persistRuntimeQueues(queueFilePath, runtimeQueues);
    publishQueuesChanged(options.onQueuesChanged, runtimeQueues);
    throw error;
  }
}

function readDispatchTargetSession(
  activeSessionId: string | null,
  preferredSession: ILiveAgentSessionSnapshot | null,
  readLiveAgentSession: ReadLiveAgentSession,
): ILiveAgentSessionSnapshot | null {
  if (preferredSession !== null && preferredSession.sessionId === activeSessionId) {
    return preferredSession;
  }

  if (activeSessionId === null) {
    return null;
  }

  return readLiveAgentSession(activeSessionId);
}

function createRuntimeQueueForEnqueue(
  annotation: IAnnotationSubmitDetail,
  timestamp: number,
  liveTargetSession: ILiveAgentSessionSnapshot | null,
): IRuntimeAnnotationQueueRecord {
  if (liveTargetSession === null) {
    return createRuntimeQueueRecord(createPersistedQueueEntry(annotation, timestamp));
  }

  if (liveTargetSession.agentStatus === "finished") {
    const queue = createRuntimeQueueRecord(createPersistedQueueEntry(annotation, timestamp));

    queue.activeSessionId = liveTargetSession.sessionId;
    queue.status = "launching";
    return queue;
  }

  return {
    activeSessionId: liveTargetSession.sessionId,
    currentEntry: createPersistedQueueEntry(liveTargetSession.annotation, liveTargetSession.annotation.submittedAt),
    pauseReason: null,
    pendingEntries: [createPersistedQueueEntry(annotation, timestamp)],
    queueId: crypto.randomUUID(),
    status: liveTargetSession.agentStatus === "working" ? "working" : "launching",
  };
}

function createRuntimeQueueRecord(currentEntry: IPersistedAnnotationQueueEntry): IRuntimeAnnotationQueueRecord {
  return {
    activeSessionId: null,
    currentEntry,
    pauseReason: null,
    pendingEntries: [],
    queueId: crypto.randomUUID(),
    status: "launching",
  };
}

function createPersistedQueueEntry(
  annotation: IAnnotationSubmitDetail,
  timestamp: number,
): IPersistedAnnotationQueueEntry {
  return {
    annotation,
    createdAt: timestamp,
    entryId: crypto.randomUUID(),
    updatedAt: timestamp,
  };
}

function createQueueSnapshots(runtimeQueues: Map<string, IRuntimeAnnotationQueueRecord>): IAnnotationQueueSnapshot[] {
  return [...runtimeQueues.values()].map((queue): IAnnotationQueueSnapshot => {
    const entries: IAnnotationQueueEntrySnapshot[] = [
      {
        annotation: queue.currentEntry.annotation,
        createdAt: queue.currentEntry.createdAt,
        entryId: queue.currentEntry.entryId,
        state: queue.status === "paused" ? "paused-active" : "active",
        updatedAt: queue.currentEntry.updatedAt,
      },
      ...queue.pendingEntries.map((entry): IAnnotationQueueEntrySnapshot => {
        return {
          annotation: entry.annotation,
          createdAt: entry.createdAt,
          entryId: entry.entryId,
          state: "queued",
          updatedAt: entry.updatedAt,
        };
      }),
    ];

    return {
      activeSessionId: queue.activeSessionId,
      entries,
      pauseReason: mapPublicPauseReason(queue.pauseReason),
      queueId: queue.queueId,
      status: queue.status,
    };
  });
}

function mapPublicPauseReason(value: PersistedAnnotationQueuePauseReason): AnnotationQueuePauseReason | null {
  return value === "session-exited-before-finished" || value === "user-terminated" ? value : null;
}

function publishQueuesChanged(
  onQueuesChanged: ICreateAnnotationQueueStoreOptions["onQueuesChanged"],
  runtimeQueues: Map<string, IRuntimeAnnotationQueueRecord>,
): void {
  onQueuesChanged?.(createQueueSnapshots(runtimeQueues));
}

function findQueueBySessionId(
  runtimeQueues: Map<string, IRuntimeAnnotationQueueRecord>,
  sessionId: string,
): IRuntimeAnnotationQueueRecord | null {
  for (const queue of runtimeQueues.values()) {
    if (queue.activeSessionId === sessionId) {
      return queue;
    }
  }

  return null;
}

function findQueueByServiceKey(
  runtimeQueues: Map<string, IRuntimeAnnotationQueueRecord>,
  routedServices: IRoutedServiceIdentity[],
  serviceKey: string,
): IRuntimeAnnotationQueueRecord | null {
  let pausedMatch: IRuntimeAnnotationQueueRecord | null = null;

  for (const queue of runtimeQueues.values()) {
    if (readQueueServiceKey(queue, routedServices) !== serviceKey) {
      continue;
    }

    if (queue.status !== "paused") {
      return queue;
    }

    pausedMatch ??= queue;
  }

  return pausedMatch;
}

function shouldUseLiveTargetSession(
  annotationServiceKey: string | null,
  targetLiveSession: ILiveAgentSessionSnapshot | null,
  routedServices: IRoutedServiceIdentity[],
): boolean {
  if (annotationServiceKey === null || targetLiveSession === null) {
    return true;
  }

  const targetServiceKey: string | null = readAnnotationServiceKey(targetLiveSession.annotation, routedServices);

  return targetServiceKey === null || targetServiceKey === annotationServiceKey;
}

function readQueueServiceKey(
  queue: IRuntimeAnnotationQueueRecord,
  routedServices: IRoutedServiceIdentity[],
): string | null {
  return readAnnotationServiceKey(queue.currentEntry.annotation, routedServices);
}

function readAnnotationServiceKey(
  annotation: IAnnotationSubmitDetail,
  routedServices: IRoutedServiceIdentity[],
): string | null {
  return resolveRoutedServiceKeyForUrl(routedServices, annotation.url);
}

function locateQueueEntry(
  runtimeQueues: Map<string, IRuntimeAnnotationQueueRecord>,
  entryId: string,
): ILocatedQueueEntry | null {
  for (const queue of runtimeQueues.values()) {
    if (queue.currentEntry.entryId === entryId) {
      return {
        entry: queue.currentEntry,
        entryState: queue.status === "paused" ? "paused-active" : "active",
        pendingIndex: -1,
        queue,
      };
    }

    const pendingIndex: number = queue.pendingEntries.findIndex((entry): boolean => entry.entryId === entryId);

    if (pendingIndex !== -1) {
      const pendingEntry: IPersistedAnnotationQueueEntry | undefined = queue.pendingEntries[pendingIndex];

      if (pendingEntry === undefined) {
        continue;
      }

      return {
        entry: pendingEntry,
        entryState: "queued",
        pendingIndex,
        queue,
      };
    }
  }

  return null;
}

function pauseQueueForSession(
  runtimeQueues: Map<string, IRuntimeAnnotationQueueRecord>,
  queueFilePath: string,
  onQueuesChanged: ICreateAnnotationQueueStoreOptions["onQueuesChanged"],
  sessionId: string,
  pauseReason: Exclude<PersistedAnnotationQueuePauseReason, "shutdown" | null>,
): void {
  const queue = findQueueBySessionId(runtimeQueues, sessionId);

  if (queue === null) {
    return;
  }

  queue.activeSessionId = null;
  queue.pauseReason = pauseReason;
  queue.status = "paused";
  persistRuntimeQueues(queueFilePath, runtimeQueues);
  publishQueuesChanged(onQueuesChanged, runtimeQueues);
}

function isAnnotationMarkerPayload(value: unknown): value is IAnnotationMarkerPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const accessibility: unknown = Reflect.get(value, "accessibility");
  const boundingBox: unknown = Reflect.get(value, "boundingBox");
  const computedStyles: unknown = Reflect.get(value, "computedStyles");
  const computedStylesObj: unknown = Reflect.get(value, "computedStylesObj");
  const cssClasses: unknown = Reflect.get(value, "cssClasses");
  const element: unknown = Reflect.get(value, "element");
  const elementPath: unknown = Reflect.get(value, "elementPath");
  const fullPath: unknown = Reflect.get(value, "fullPath");
  const isFixed: unknown = Reflect.get(value, "isFixed");
  const markerNumber: unknown = Reflect.get(value, "markerNumber");
  const nearbyElements: unknown = Reflect.get(value, "nearbyElements");
  const nearbyText: unknown = Reflect.get(value, "nearbyText");
  const selectedText: unknown = Reflect.get(value, "selectedText");

  return (
    typeof accessibility === "string" &&
    isRectSnapshot(boundingBox) &&
    isStringRecord(computedStylesObj) &&
    typeof computedStyles === "string" &&
    typeof cssClasses === "string" &&
    typeof element === "string" &&
    typeof elementPath === "string" &&
    typeof fullPath === "string" &&
    typeof isFixed === "boolean" &&
    typeof markerNumber === "number" &&
    typeof nearbyElements === "string" &&
    typeof nearbyText === "string" &&
    (typeof selectedText === "string" || selectedText === undefined)
  );
}

function isAnnotationSubmitDetail(value: unknown): value is IAnnotationSubmitDetail {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const comment: unknown = Reflect.get(value, "comment");
  const markers: unknown = Reflect.get(value, "markers");
  const stackName: unknown = Reflect.get(value, "stackName");
  const submittedAt: unknown = Reflect.get(value, "submittedAt");
  const title: unknown = Reflect.get(value, "title");
  const url: unknown = Reflect.get(value, "url");

  return (
    typeof comment === "string" &&
    Array.isArray(markers) &&
    markers.every((marker: unknown): marker is IAnnotationMarkerPayload => isAnnotationMarkerPayload(marker)) &&
    typeof stackName === "string" &&
    typeof submittedAt === "number" &&
    typeof title === "string" &&
    typeof url === "string"
  );
}

function isRectSnapshot(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "height") === "number" &&
    typeof Reflect.get(value, "width") === "number" &&
    typeof Reflect.get(value, "x") === "number" &&
    typeof Reflect.get(value, "y") === "number"
  );
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.values(value).every((entry): boolean => typeof entry === "string")
  );
}
