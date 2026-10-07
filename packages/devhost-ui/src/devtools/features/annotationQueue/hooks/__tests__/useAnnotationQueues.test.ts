import { act, renderHook } from "@testing-library/react";
import { afterEach, assert, beforeEach, describe, expect, test, vi } from "vitest";

import type { IMockWebSocketConnection } from "../../../../../../test-support/createMockWebSocket";
import { installMockFetch, type IInstalledMockFetch } from "../../../../../../test-support/installMockFetch";
import {
  installMockWebSocket,
  type IInstalledMockWebSocket,
} from "../../../../../../test-support/installMockWebSocket";
import type { IAnnotationQueueSnapshot } from "../../types";
import { useAnnotationQueues } from "../useAnnotationQueues";

type ServerAction = () => void;

interface IAnnotationQueuesProps {
  enabled: boolean;
}

const queue: IAnnotationQueueSnapshot = {
  activeSessionId: "session-1",
  entries: [
    {
      actionId: "agent",
      annotation: {
        comment: "Tighten the header spacing",
        markers: [],
        stackName: "shop",
        submittedAt: 1,
        title: "Checkout",
        url: "https://shop.localhost/checkout",
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
};
const jsonHeaders: Record<string, string> = { "content-type": "application/json" };

let webSocket: IInstalledMockWebSocket;
let mockFetch: IInstalledMockFetch;

// Lets the socket's queued open or close run, and applies the state updates a server action causes.
async function settle(action?: ServerAction): Promise<void> {
  await act(async (): Promise<void> => {
    action?.();
  });
}

function renderQueues(enabled: boolean = true) {
  return renderHook((props: IAnnotationQueuesProps) => useAnnotationQueues(props.enabled), {
    initialProps: { enabled },
  });
}

async function connectQueues() {
  const hook = renderQueues();

  await settle();

  const connection: IMockWebSocketConnection | undefined = webSocket.connections.at(0);

  assert(connection !== undefined);

  return { connection, hook };
}

beforeEach(() => {
  webSocket = installMockWebSocket();
  mockFetch = installMockFetch();
});

afterEach(() => {
  vi.useRealTimers();
  webSocket.restore();
  mockFetch.restore();
});

describe("useAnnotationQueues", () => {
  test("opens one queue stream on the current host and publishes each snapshot", async () => {
    const { connection, hook } = await connectQueues();

    expect(connection.url.href).toBe(`ws://${window.location.host}/__devhost__/ws/annotation-queues`);
    expect(webSocket.connections).toHaveLength(1);
    expect(hook.result.current.queues).toEqual([]);
    expect(hook.result.current.errorMessage).toBeNull();

    await settle(() => connection.send({ queues: [queue], type: "snapshot" }));
    expect(hook.result.current.queues).toEqual([queue]);

    await settle(() => connection.send({ queues: [], type: "snapshot" }));
    expect(hook.result.current.queues).toEqual([]);
  });

  test("reports frames it cannot read, keeps the last queues, and recovers on the next snapshot", async () => {
    const { connection, hook } = await connectQueues();

    await settle(() => connection.send({ queues: [queue], type: "snapshot" }));

    await settle(() => connection.sendFrame("{"));
    expect(hook.result.current.errorMessage).toBe("devhost annotation queue stream sent malformed data.");

    await settle(() => connection.send({ queues: [{ queueId: "queue-1" }], type: "snapshot" }));
    expect(hook.result.current.errorMessage).toBe("devhost annotation queue stream sent malformed data.");

    await settle(() => connection.sendFrame(new ArrayBuffer(1)));
    expect(hook.result.current.errorMessage).toBe("devhost annotation queue stream sent a non-text message.");
    expect(hook.result.current.queues).toEqual([queue]);

    await settle(() => connection.send({ queues: [queue], type: "snapshot" }));
    expect(hook.result.current.errorMessage).toBeNull();
  });

  test("reports a dropped stream and keeps the queues it had", async () => {
    const { connection, hook } = await connectQueues();

    await settle(() => connection.send({ queues: [queue], type: "snapshot" }));
    await settle(() => connection.close(1006));

    expect(hook.result.current.errorMessage).toBe("devhost annotation queue stream disconnected.");
    expect(hook.result.current.queues).toEqual([queue]);
  });

  test("reopens the stream a second after it drops and clears the report once it is back", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { connection, hook } = await connectQueues();

    await settle(() => connection.close(1006));
    expect(hook.result.current.errorMessage).toBe("devhost annotation queue stream disconnected.");

    await settle(() => vi.advanceTimersByTime(1_000));
    expect(hook.result.current.errorMessage).toBeNull();

    const reopened: IMockWebSocketConnection | undefined = webSocket.connections.at(1);

    assert(reopened !== undefined);
    expect(reopened.url.href).toBe(connection.url.href);

    await settle(() => reopened.send({ queues: [queue], type: "snapshot" }));
    expect(hook.result.current.queues).toEqual([queue]);
  });

  test("does not reopen a dropped stream once it is disabled", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { connection, hook } = await connectQueues();

    await settle(() => connection.close(1006));
    hook.rerender({ enabled: false });
    await settle(() => vi.advanceTimersByTime(60_000));

    expect(webSocket.attemptCount).toBe(1);
    expect(hook.result.current.errorMessage).toBeNull();
  });

  test("reports nothing when the server closes the stream normally", async () => {
    const { connection, hook } = await connectQueues();

    await settle(() => connection.close(1000));

    expect(hook.result.current.errorMessage).toBeNull();
  });

  test("closes the stream when it unmounts", async () => {
    const { connection, hook } = await connectQueues();

    expect(connection.readClientClosure()).toBeNull();

    hook.unmount();
    expect(connection.readClientClosure()).toEqual({ code: 1000, reason: "devtools unmounted" });
  });

  test("opens no stream and makes no request while disabled", async () => {
    const hook = renderQueues(false);

    await settle();
    expect(webSocket.connections).toHaveLength(0);

    expect(await act(() => hook.result.current.saveEntry("entry-1", "Updated"))).toBe(false);
    expect(await act(() => hook.result.current.removeEntry("entry-1"))).toBe(false);
    expect(await act(() => hook.result.current.resumeQueue("queue-1", "dark"))).toBeNull();
    expect(mockFetch.fetch).toHaveBeenCalledTimes(0);
  });

  test("closes the stream and clears its queues and error when it is disabled", async () => {
    const { connection, hook } = await connectQueues();

    await settle(() => connection.send({ queues: [queue], type: "snapshot" }));
    await settle(() => connection.sendFrame("{"));

    hook.rerender({ enabled: false });
    // A snapshot that was already on its way reaches the closing socket and must not bring the queues back.
    await settle(() => connection.send({ queues: [queue], type: "snapshot" }));
    expect(hook.result.current.queues).toEqual([]);
    expect(hook.result.current.errorMessage).toBeNull();
    expect(connection.readClientClosure()).toEqual({ code: 1000, reason: "devtools unmounted" });

    // The close the hook asked for is not a dropped stream.
    await settle();
    expect(hook.result.current.errorMessage).toBeNull();
  });

  test("reports nothing when the stream it is closing ends abnormally", async () => {
    const { connection, hook } = await connectQueues();

    hook.rerender({ enabled: false });
    // The server is gone before the closing handshake completes.
    await settle(() => connection.close(1006));

    expect(hook.result.current.errorMessage).toBeNull();
  });

  test("saveEntry patches the comment and reports the entry as pending until the server answers", async () => {
    const { hook } = await connectQueues();
    const response = Promise.withResolvers<Response>();

    mockFetch.fetch.mockReturnValueOnce(response.promise);

    let saved: Promise<boolean> = Promise.resolve(false);

    act(() => {
      saved = hook.result.current.saveEntry("entry-1", "Use 8px instead");
    });
    expect(hook.result.current.isEntryMutationPending("entry-1")).toBe(true);
    expect(hook.result.current.isEntryMutationPending("entry-2")).toBe(false);
    expect(mockFetch.fetch.mock.calls).toEqual([
      [
        "/__devhost__/annotation-queues/entry-1",
        { body: '{"comment":"Use 8px instead"}', headers: jsonHeaders, method: "PATCH" },
      ],
    ]);

    await act(async (): Promise<void> => {
      response.resolve(new Response(""));
      await saved;
    });
    expect(await saved).toBe(true);
    expect(hook.result.current.isEntryMutationPending("entry-1")).toBe(false);
    expect(hook.result.current.errorMessage).toBeNull();
  });

  test("removeEntry deletes the entry", async () => {
    const { hook } = await connectQueues();

    mockFetch.fetch.mockResolvedValueOnce(new Response(""));

    expect(await act(() => hook.result.current.removeEntry("entry-1"))).toBe(true);
    expect(mockFetch.fetch.mock.calls).toEqual([["/__devhost__/annotation-queues/entry-1", { method: "DELETE" }]]);
    expect(hook.result.current.isEntryMutationPending("entry-1")).toBe(false);
  });

  test("reports why an entry change failed, and clears the report after the next change that succeeds", async () => {
    const { hook } = await connectQueues();

    mockFetch.fetch.mockResolvedValueOnce(new Response("The entry is already running.", { status: 409 }));
    expect(await act(() => hook.result.current.saveEntry("entry-1", "Too late"))).toBe(false);
    expect(hook.result.current.errorMessage).toBe("The entry is already running.");
    expect(hook.result.current.isEntryMutationPending("entry-1")).toBe(false);

    mockFetch.fetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await act(() => hook.result.current.removeEntry("entry-1"))).toBe(false);
    expect(hook.result.current.errorMessage).toBe("Failed to fetch");

    mockFetch.fetch.mockResolvedValueOnce(new Response(""));
    expect(await act(() => hook.result.current.removeEntry("entry-1"))).toBe(true);
    expect(hook.result.current.errorMessage).toBeNull();
  });

  test("resumeQueue posts the current color scheme and returns the resumed session", async () => {
    const { hook } = await connectQueues();
    const response = Promise.withResolvers<Response>();

    mockFetch.fetch.mockReturnValueOnce(response.promise);

    let resumed: Promise<string | null> = Promise.resolve(null);

    act(() => {
      resumed = hook.result.current.resumeQueue("queue-1", "dark");
    });
    expect(hook.result.current.isQueueResumePending("queue-1")).toBe(true);
    expect(hook.result.current.isQueueResumePending("queue-2")).toBe(false);
    expect(mockFetch.fetch.mock.calls).toEqual([
      [
        "/__devhost__/annotation-queues/queue-1/resume",
        { body: '{"colorScheme":"dark"}', headers: jsonHeaders, method: "POST" },
      ],
    ]);

    await act(async (): Promise<void> => {
      response.resolve(Response.json({ sessionId: "session-9", success: true }));
      await resumed;
    });
    expect(await resumed).toBe("session-9");
    expect(hook.result.current.isQueueResumePending("queue-1")).toBe(false);
    expect(hook.result.current.errorMessage).toBeNull();
  });

  test("resumeQueue returns no session and reports why when the queue cannot resume", async () => {
    const { hook } = await connectQueues();

    mockFetch.fetch.mockResolvedValueOnce(new Response("The agent is not installed.", { status: 500 }));
    expect(await act(() => hook.result.current.resumeQueue("queue-1", "light"))).toBeNull();
    expect(hook.result.current.errorMessage).toBe("The agent is not installed.");
    expect(hook.result.current.isQueueResumePending("queue-1")).toBe(false);

    mockFetch.fetch.mockResolvedValueOnce(Response.json({ success: true }));
    expect(await act(() => hook.result.current.resumeQueue("queue-1", "light"))).toBeNull();
    expect(hook.result.current.errorMessage).toBe("Annotation queue resume returned an invalid response.");
  });
});
