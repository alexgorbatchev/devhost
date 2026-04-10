import { describe, expect, test } from "bun:test";

import {
  isAnnotationQueueEntryEditable,
  isAnnotationQueueEntrySaveDisabled,
  mergeAnnotationQueueDrafts,
  readAnnotationQueuePauseMessage,
  shouldRenderAnnotationQueuePanel,
} from "../panelUtils";
import type { IAnnotationQueueEntrySnapshot, IAnnotationQueueSnapshot } from "../types";

const queuedEntry: IAnnotationQueueEntrySnapshot = {
  annotation: {
    comment: "Queued change",
    markers: [],
    stackName: "hello-stack",
    submittedAt: 1,
    title: "Example page",
    url: "https://example.test/path",
  },
  createdAt: 1,
  entryId: "queued-entry",
  state: "queued",
  updatedAt: 1,
};

const pausedEntry: IAnnotationQueueEntrySnapshot = {
  ...queuedEntry,
  entryId: "paused-entry",
  state: "paused-active",
};

const activeEntry: IAnnotationQueueEntrySnapshot = {
  ...queuedEntry,
  entryId: "active-entry",
  state: "active",
};

const pausedQueue: IAnnotationQueueSnapshot = {
  activeSessionId: null,
  entries: [pausedEntry],
  pauseReason: "user-terminated",
  queueId: "queue-1",
  status: "paused",
};

describe("AnnotationQueuePanel", () => {
  test("returns false when there is nothing to render", () => {
    expect(shouldRenderAnnotationQueuePanel([], null)).toBe(false);
    expect(shouldRenderAnnotationQueuePanel([], "boom")).toBe(true);
  });

  test("treats queued and paused-active entries as editable", () => {
    expect(isAnnotationQueueEntryEditable(activeEntry)).toBe(false);
    expect(isAnnotationQueueEntryEditable(queuedEntry)).toBe(true);
    expect(isAnnotationQueueEntryEditable(pausedEntry)).toBe(true);
  });

  test("merges editable entry drafts in dispatch order", () => {
    const mergedDrafts = mergeAnnotationQueueDrafts(
      [{ comment: "Updated queued change", entryId: queuedEntry.entryId }],
      [
        {
          ...pausedQueue,
          entries: [activeEntry, queuedEntry, pausedEntry],
        },
      ],
    );

    expect(mergedDrafts).toEqual([
      { comment: "Updated queued change", entryId: queuedEntry.entryId },
      { comment: pausedEntry.annotation.comment, entryId: pausedEntry.entryId },
    ]);
  });

  test("disables save while pending, blank, or unchanged", () => {
    expect(isAnnotationQueueEntrySaveDisabled(queuedEntry, queuedEntry.annotation.comment, false)).toBe(true);
    expect(isAnnotationQueueEntrySaveDisabled(queuedEntry, "   ", false)).toBe(true);
    expect(isAnnotationQueueEntrySaveDisabled(queuedEntry, "Updated queued change", true)).toBe(true);
    expect(isAnnotationQueueEntrySaveDisabled(queuedEntry, "Updated queued change", false)).toBe(false);
  });

  test("renders queue pause copy for both pause reasons", () => {
    expect(readAnnotationQueuePauseMessage("user-terminated")).toBe(
      "Session terminated. Edit the head annotation or resume the queue.",
    );
    expect(readAnnotationQueuePauseMessage("session-exited-before-finished")).toBe(
      "Session exited before the annotation finished. Resume to retry.",
    );
  });
});
