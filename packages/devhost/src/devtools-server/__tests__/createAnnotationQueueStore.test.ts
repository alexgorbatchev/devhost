import assert from "node:assert";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { AnnotationQueueConflictError, createAnnotationQueueStore } from "../createAnnotationQueueStore";
import type { IAnnotationSubmitDetail } from "../../devtools/features/annotationComposer/types";
import type { IDevhostLogger } from "../../utils/createLogger";

interface ILiveSessionRecord {
  agentStatus: "working" | "finished" | null;
  annotation: IAnnotationSubmitDetail;
  sessionId: string;
}

interface IWrittenAnnotationRecord {
  annotation: IAnnotationSubmitDetail;
  sessionId: string;
}

interface IQueueStoreHarness {
  liveSessions: Map<string, ILiveSessionRecord>;
  loggerErrors: string[];
  manifestPath: string;
  startedAnnotations: IAnnotationSubmitDetail[];
  stateDirectoryPath: string;
  store: ReturnType<typeof createAnnotationQueueStore>;
  writtenAnnotations: IWrittenAnnotationRecord[];
}

interface IQueueStoreHarnessOverrides {
  manifestPath?: string;
  stateDirectoryPath?: string;
}

describe("createAnnotationQueueStore", () => {
  test("enqueue to a new queue persists the head entry and starts a new session", async () => {
    const harness = createQueueStoreHarness();
    const annotation = createAnnotationDetail("First annotation");

    const result = await harness.store.enqueue(annotation);
    const queueFile = readQueueFile(harness.stateDirectoryPath, harness.manifestPath, "hello-stack");

    expect(result.sessionId).toBe("session-1");
    expect(harness.startedAnnotations).toEqual([annotation]);
    expect(queueFile.queues).toHaveLength(1);
    expect(queueFile.queues[0]?.currentEntry.annotation.comment).toBe("First annotation");
    expect(harness.store.getSnapshot()).toEqual([
      expect.objectContaining({
        activeSessionId: "session-1",
        status: "launching",
      }),
    ]);
  });

  test("enqueue to an existing bound live session appends in fifo order without starting a new session", async () => {
    const harness = createQueueStoreHarness();
    const firstAnnotation = createAnnotationDetail("First annotation");
    const secondAnnotation = createAnnotationDetail("Second annotation", 2);

    const firstResult = await harness.store.enqueue(firstAnnotation);

    harness.liveSessions.get(firstResult.sessionId)!.agentStatus = "working";
    await harness.store.handleAgentStatus(firstResult.sessionId, "working");
    await harness.store.enqueue(secondAnnotation, firstResult.sessionId);

    const snapshot = harness.store.getSnapshot();

    expect(harness.startedAnnotations).toEqual([firstAnnotation]);
    expect(snapshot[0]?.entries.map((entry) => entry.annotation.comment)).toEqual([
      "First annotation",
      "Second annotation",
    ]);
    expect(snapshot[0]?.status).toBe("working");
  });

  test("working status updates the queue status only", async () => {
    const harness = createQueueStoreHarness();
    const result = await harness.store.enqueue(createAnnotationDetail("First annotation"));

    await harness.store.handleAgentStatus(result.sessionId, "working");

    expect(harness.store.getSnapshot()[0]?.status).toBe("working");
    expect(harness.startedAnnotations).toHaveLength(1);
  });

  test("finished status removes the head and dispatches the next queued annotation", async () => {
    const harness = createQueueStoreHarness();
    const firstAnnotation = createAnnotationDetail("First annotation");
    const secondAnnotation = createAnnotationDetail("Second annotation", 2);
    const result = await harness.store.enqueue(firstAnnotation);

    harness.liveSessions.get(result.sessionId)!.agentStatus = "working";
    await harness.store.handleAgentStatus(result.sessionId, "working");
    await harness.store.enqueue(secondAnnotation, result.sessionId);
    await harness.store.handleAgentStatus(result.sessionId, "finished");

    expect(harness.writtenAnnotations).toEqual([{ annotation: secondAnnotation, sessionId: result.sessionId }]);
    expect(harness.store.getSnapshot()[0]?.entries.map((entry) => entry.annotation.comment)).toEqual([
      "Second annotation",
    ]);
    expect(harness.store.getSnapshot()[0]?.status).toBe("launching");
  });

  test("a queue with one entry is deleted after finished", async () => {
    const harness = createQueueStoreHarness();
    const result = await harness.store.enqueue(createAnnotationDetail("First annotation"));

    await harness.store.handleAgentStatus(result.sessionId, "finished");

    expect(harness.store.getSnapshot()).toEqual([]);
    expect(() => readQueueFile(harness.stateDirectoryPath, harness.manifestPath, "hello-stack")).toThrow();
  });

  test("paused queue resume starts a replacement session", async () => {
    const harness = createQueueStoreHarness();
    const firstResult = await harness.store.enqueue(createAnnotationDetail("First annotation"));

    await harness.store.handleSessionExited(firstResult.sessionId);

    const pausedQueue = harness.store.getSnapshot()[0];
    const resumeResult = await harness.store.resumeQueue(pausedQueue!.queueId);

    expect(resumeResult.sessionId).toBe("session-2");
    expect(harness.startedAnnotations.map((annotation) => annotation.comment)).toEqual([
      "First annotation",
      "First annotation",
    ]);
  });

  test("deleting a queued item preserves the order of the remaining items", async () => {
    const harness = createQueueStoreHarness();
    const firstAnnotation = createAnnotationDetail("First annotation");
    const secondAnnotation = createAnnotationDetail("Second annotation", 2);
    const thirdAnnotation = createAnnotationDetail("Third annotation", 3);
    const result = await harness.store.enqueue(firstAnnotation);

    harness.liveSessions.get(result.sessionId)!.agentStatus = "working";
    await harness.store.handleAgentStatus(result.sessionId, "working");
    await harness.store.enqueue(secondAnnotation, result.sessionId);
    await harness.store.enqueue(thirdAnnotation, result.sessionId);

    const queuedEntryId = harness.store.getSnapshot()[0]?.entries[1]?.entryId;

    await harness.store.deleteEntry(queuedEntryId!);

    expect(harness.store.getSnapshot()[0]?.entries.map((entry) => entry.annotation.comment)).toEqual([
      "First annotation",
      "Third annotation",
    ]);
  });

  test("deleting a paused-active head promotes the next entry to the head", async () => {
    const harness = createQueueStoreHarness();
    const firstAnnotation = createAnnotationDetail("First annotation");
    const secondAnnotation = createAnnotationDetail("Second annotation", 2);
    const result = await harness.store.enqueue(firstAnnotation);

    harness.liveSessions.get(result.sessionId)!.agentStatus = "working";
    await harness.store.handleAgentStatus(result.sessionId, "working");
    await harness.store.enqueue(secondAnnotation, result.sessionId);
    await harness.store.handleSessionExited(result.sessionId);

    const pausedHeadId = harness.store.getSnapshot()[0]?.entries[0]?.entryId;

    await harness.store.deleteEntry(pausedHeadId!);

    expect(harness.store.getSnapshot()[0]?.entries.map((entry) => entry.annotation.comment)).toEqual([
      "Second annotation",
    ]);
    expect(harness.store.getSnapshot()[0]?.entries[0]?.state).toBe("paused-active");
  });

  test("editing a queued item updates only the annotation comment", async () => {
    const harness = createQueueStoreHarness();
    const firstAnnotation = createAnnotationDetail("First annotation");
    const secondAnnotation = createAnnotationDetail("Second annotation", 2);
    const result = await harness.store.enqueue(firstAnnotation);

    harness.liveSessions.get(result.sessionId)!.agentStatus = "working";
    await harness.store.handleAgentStatus(result.sessionId, "working");
    await harness.store.enqueue(secondAnnotation, result.sessionId);

    const queuedEntry = harness.store.getSnapshot()[0]?.entries[1]!;

    await harness.store.updateEntryComment(queuedEntry.entryId, "Updated second annotation");

    const updatedEntry = harness.store.getSnapshot()[0]?.entries[1]!;

    expect(updatedEntry.annotation.comment).toBe("Updated second annotation");
    expect(updatedEntry.annotation.url).toBe(secondAnnotation.url);
  });

  test("editing an active item throws a conflict", async () => {
    const harness = createQueueStoreHarness();
    const result = await harness.store.enqueue(createAnnotationDetail("First annotation"));
    const activeEntryId = harness.store.getSnapshot()[0]?.entries[0]?.entryId;

    await expect(harness.store.updateEntryComment(activeEntryId!, "Updated first annotation")).rejects.toBeInstanceOf(
      AnnotationQueueConflictError,
    );

    await expect(harness.store.deleteEntry(activeEntryId!)).rejects.toBeInstanceOf(AnnotationQueueConflictError);
    expect(result.sessionId).toBe("session-1");
  });

  test("corrupted persisted files are repaired as specified", async () => {
    const stateDirectoryPath = createTempStateDirectory();
    const manifestPath = "/tmp/project/devhost.toml";
    const queueFilePath = createQueueFilePath(stateDirectoryPath, manifestPath, "hello-stack");

    mkdirSync(join(stateDirectoryPath, "devtools", "annotation-queues"), { recursive: true });
    writeFileSync(
      queueFilePath,
      JSON.stringify(
        {
          queues: [
            {
              currentEntry: null,
              pauseReason: null,
              pendingEntries: [
                createPersistedEntry(createAnnotationDetail("Recovered pending annotation"), 2),
                { entryId: "broken-pending" },
              ],
              queueId: "queue-valid-after-repair",
            },
            {
              currentEntry: { entryId: "broken-current" },
              pauseReason: null,
              pendingEntries: [],
              queueId: 123,
            },
          ],
          version: 1,
        },
        null,
        2,
      ),
      "utf8",
    );

    const harness = createQueueStoreHarness({ manifestPath, stateDirectoryPath });

    expect(harness.store.getSnapshot()).toHaveLength(1);
    expect(harness.store.getSnapshot()[0]?.entries[0]?.annotation.comment).toBe("Recovered pending annotation");
    expect(harness.loggerErrors).toEqual([]);
  });

  test("persisted queues auto-resume on startup unless user-terminated", async () => {
    const stateDirectoryPath = createTempStateDirectory();
    const manifestPath = "/tmp/project/devhost.toml";
    const queueFilePath = createQueueFilePath(stateDirectoryPath, manifestPath, "hello-stack");

    mkdirSync(join(stateDirectoryPath, "devtools", "annotation-queues"), { recursive: true });
    writeFileSync(
      queueFilePath,
      JSON.stringify(
        {
          queues: [
            {
              currentEntry: createPersistedEntry(createAnnotationDetail("Auto resume annotation"), 1),
              pauseReason: "shutdown",
              pendingEntries: [],
              queueId: "queue-auto-resume",
            },
            {
              currentEntry: createPersistedEntry(createAnnotationDetail("Manual resume annotation"), 2),
              pauseReason: "user-terminated",
              pendingEntries: [],
              queueId: "queue-user-paused",
            },
          ],
          version: 1,
        },
        null,
        2,
      ),
      "utf8",
    );

    const harness = createQueueStoreHarness({ manifestPath, stateDirectoryPath });

    await harness.store.resumePersistedQueues();

    expect(harness.startedAnnotations.map((annotation) => annotation.comment)).toEqual(["Auto resume annotation"]);
    expect(harness.store.getSnapshot()).toEqual([
      expect.objectContaining({ queueId: "queue-auto-resume", status: "launching" }),
      expect.objectContaining({ pauseReason: "user-terminated", queueId: "queue-user-paused", status: "paused" }),
    ]);
  });
});

function createQueueStoreHarness(overrides: IQueueStoreHarnessOverrides = {}): IQueueStoreHarness {
  const liveSessions: Map<string, ILiveSessionRecord> = new Map();
  const loggerErrors: string[] = [];
  const manifestPath: string = overrides.manifestPath ?? "/tmp/project/devhost.toml";
  const startedAnnotations: IAnnotationSubmitDetail[] = [];
  const stateDirectoryPath: string = overrides.stateDirectoryPath ?? createTempStateDirectory();
  const writtenAnnotations: IWrittenAnnotationRecord[] = [];
  let nextSessionNumber: number = 1;
  const logger: IDevhostLogger = {
    error(message: string): void {
      loggerErrors.push(message);
    },
    info(): void {},
    withLabel(): IDevhostLogger {
      return logger;
    },
  };
  const store = createAnnotationQueueStore({
    logger,
    manifestPath,
    readLiveAgentSession: (sessionId: string) => {
      return liveSessions.get(sessionId) ?? null;
    },
    stackName: "hello-stack",
    startAgentSession: (annotation: IAnnotationSubmitDetail): string => {
      const sessionId: string = `session-${nextSessionNumber}`;

      nextSessionNumber += 1;
      startedAnnotations.push(annotation);
      liveSessions.set(sessionId, {
        agentStatus: null,
        annotation,
        sessionId,
      });
      return sessionId;
    },
    stateDirectoryPath,
    writeAnnotationToSession: (sessionId: string, annotation: IAnnotationSubmitDetail): void => {
      const liveSession = liveSessions.get(sessionId);

      assert(liveSession !== undefined, `Missing live session ${sessionId}`);

      liveSession.annotation = annotation;
      liveSession.agentStatus = null;
      writtenAnnotations.push({ annotation, sessionId });
    },
  });

  return {
    liveSessions,
    loggerErrors,
    manifestPath,
    startedAnnotations,
    stateDirectoryPath,
    store,
    writtenAnnotations,
  };
}

function createAnnotationDetail(comment: string, submittedAt: number = 1): IAnnotationSubmitDetail {
  return {
    comment,
    markers: [],
    stackName: "hello-stack",
    submittedAt,
    title: "Example page",
    url: `https://example.test/path-${submittedAt}`,
  };
}

function createPersistedEntry(annotation: IAnnotationSubmitDetail, timestamp: number) {
  return {
    annotation,
    createdAt: timestamp,
    entryId: `entry-${timestamp}`,
    updatedAt: timestamp,
  };
}

function createQueueFilePath(stateDirectoryPath: string, manifestPath: string, stackName: string): string {
  return join(
    stateDirectoryPath,
    "devtools",
    "annotation-queues",
    `${stackName}-${createHash("sha256").update(manifestPath).digest("hex").slice(0, 12)}.json`,
  );
}

function createTempStateDirectory(): string {
  const stateDirectoryPath: string = join(tmpdir(), `devhost-annotation-queue-test-${crypto.randomUUID()}`);

  rmSync(stateDirectoryPath, { force: true, recursive: true });
  mkdirSync(stateDirectoryPath, { recursive: true });

  return stateDirectoryPath;
}

function readQueueFile(stateDirectoryPath: string, manifestPath: string, stackName: string) {
  return JSON.parse(readFileSync(createQueueFilePath(stateDirectoryPath, manifestPath, stackName), "utf8"));
}
