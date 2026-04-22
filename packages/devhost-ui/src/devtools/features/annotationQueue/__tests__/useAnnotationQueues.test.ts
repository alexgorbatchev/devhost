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

describe("useAnnotationQueues", () => {
  test("parses websocket snapshot messages", () => {
    expect(
      parseAnnotationQueuesServerMessage(
        JSON.stringify({
          queues: [
            {
              activeSessionId: "session-1",
              entries: [
                {
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

  test("attaches the control token to the annotation queue websocket URL", () => {
    expect(
      createAnnotationQueuesWebSocketUrl(
        {
          host: "example.test",
          protocol: "https:",
        },
        "secret-token",
      ),
    ).toBe("wss://example.test/__devhost__/ws/annotation-queues?token=secret-token");
  });

  test("sends authenticated patch, delete, and resume requests", async () => {
    const responses: Response[] = [
      Response.json({ success: true }),
      Response.json({ success: true }),
      Response.json({ sessionId: "session-2", success: true }),
    ];
    const fetchMock = mock(async (_input: FetchInput, _init?: RequestInit): Promise<Response> => {
      return responses.shift() ?? Response.json({ success: true });
    });

    await updateAnnotationQueueEntry("entry-1", "Updated comment", fetchMock, "secret-token");
    await deleteAnnotationQueueEntry("entry-2", fetchMock, "secret-token");

    await expect(resumeAnnotationQueue("queue-1", fetchMock, "secret-token")).resolves.toEqual({
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
        "x-devhost-control-token": "secret-token",
      },
      method: "PATCH",
    });
    expect(secondCall[0]).toBe("/__devhost__/annotation-queues/entry-2");
    expect(secondCall[1]).toEqual({
      headers: {
        "x-devhost-control-token": "secret-token",
      },
      method: "DELETE",
    });
    expect(thirdCall[0]).toBe("/__devhost__/annotation-queues/queue-1/resume");
    expect(thirdCall[1]).toEqual({
      headers: {
        "x-devhost-control-token": "secret-token",
      },
      method: "POST",
    });
  });
});
