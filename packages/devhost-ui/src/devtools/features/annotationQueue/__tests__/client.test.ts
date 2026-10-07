import assert from "node:assert";

import { describe, expect, mock, test } from "bun:test";

import {
  createAnnotationQueuesWebSocketUrl,
  deleteAnnotationQueueEntry,
  parseAnnotationQueuesServerMessage,
  resumeAnnotationQueue,
  updateAnnotationQueueEntry,
} from "../client";

type FetchInput = RequestInfo | URL;

describe("annotation queue client", () => {
  test("parses websocket snapshot messages", () => {
    expect(
      parseAnnotationQueuesServerMessage(
        JSON.stringify({
          queues: [
            {
              activeSessionId: "session-1",
              entries: [
                {
                  actionId: "agent",
                  annotation: {
                    comment: "Queued change",
                    markers: [],
                    stackName: "hello-stack",
                    submittedAt: 1,
                    title: "Example page",
                    url: "https://example.test/path",
                  },
                  createdAt: 1,
                  entryId: "entry-1",
                  state: "queued",
                  updatedAt: 1,
                },
              ],
              pauseReason: null,
              queueId: "queue-1",
              status: "working",
            },
          ],
          type: "snapshot",
        }),
      ),
    ).toEqual({
      queues: [
        {
          activeSessionId: "session-1",
          entries: [
            {
              actionId: "agent",
              annotation: {
                comment: "Queued change",
                markers: [],
                stackName: "hello-stack",
                submittedAt: 1,
                title: "Example page",
                url: "https://example.test/path",
              },
              createdAt: 1,
              entryId: "entry-1",
              state: "queued",
              updatedAt: 1,
            },
          ],
          pauseReason: null,
          queueId: "queue-1",
          status: "working",
        },
      ],
      type: "snapshot",
    });
    expect(parseAnnotationQueuesServerMessage("{}")).toBeNull();
  });

  test("creates the annotation queue websocket URL without credentials", () => {
    expect(
      createAnnotationQueuesWebSocketUrl({
        host: "example.test",
        protocol: "https:",
      }),
    ).toBe("wss://example.test/__devhost__/ws/annotation-queues");
  });

  test("sends patch, delete, and resume requests without credentials", async () => {
    const responses: Response[] = [
      Response.json({ success: true }),
      Response.json({ success: true }),
      Response.json({ sessionId: "session-2", success: true }),
    ];
    const fetchMock = mock(async (_input: FetchInput, _init?: RequestInit): Promise<Response> => {
      return responses.shift() ?? Response.json({ success: true });
    });

    await updateAnnotationQueueEntry("entry-1", "Updated comment", fetchMock);
    await deleteAnnotationQueueEntry("entry-2", fetchMock);

    await expect(resumeAnnotationQueue("queue-1", "light", fetchMock)).resolves.toEqual({
      sessionId: "session-2",
      success: true,
    });

    expect(fetchMock.mock.calls).toHaveLength(3);

    const firstCall = fetchMock.mock.calls[0];
    const secondCall = fetchMock.mock.calls[1];
    const thirdCall = fetchMock.mock.calls[2];

    assert(firstCall !== undefined);
    assert(secondCall !== undefined);
    assert(thirdCall !== undefined);
    expect(firstCall[0]).toBe("/__devhost__/annotation-queues/entry-1");
    expect(firstCall[1]).toEqual({
      body: JSON.stringify({ comment: "Updated comment" }),
      headers: {
        "content-type": "application/json",
      },
      method: "PATCH",
    });
    expect(secondCall[0]).toBe("/__devhost__/annotation-queues/entry-2");
    expect(secondCall[1]).toEqual({
      method: "DELETE",
    });
    expect(thirdCall[0]).toBe("/__devhost__/annotation-queues/queue-1/resume");
    expect(thirdCall[1]).toEqual({
      body: JSON.stringify({ colorScheme: "light" }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    });
  });
});
