import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { z } from "zod";
import { installMockFetch, type IInstalledMockFetch } from "../../../../../../test-support/installMockFetch";
import {
  installMockWebSocket,
  type IInstalledMockWebSocket,
} from "../../../../../../test-support/installMockWebSocket";
import type { IChatSession } from "../../types";
import { useAgentChat } from "../useAgentChat";

let mockFetch: IInstalledMockFetch;
let sockets: IInstalledMockWebSocket;
const session: IChatSession = { id: "chat-one", harness: "codex", projectRootPath: "/project", status: "idle" };
beforeEach(() => {
  for (const key of Object.keys(localStorage).filter((key) => key.startsWith("devhost:settings:")))
    localStorage.removeItem(key);
  mockFetch = installMockFetch();
  sockets = installMockWebSocket();
  mockFetch.fetch.mockResolvedValueOnce(
    Response.json({
      harnesses: [
        {
          id: "codex",
          label: "Codex",
          available: true,
          models: [
            {
              id: "native-model",
              label: "Native model",
              description: "Installed",
              metadata: { supportedReasoningEfforts: ["high"] },
            },
          ],
        },
      ],
    }),
  );
  mockFetch.fetch.mockResolvedValueOnce(Response.json({ sessions: [] }));
});

test("a fresh chat runtime restores the draft and model without sending them", async () => {
  const pageURL = "https://app.localhost/reload";
  const first = renderHook(() => useAgentChat({ target: "project", pageURL }));
  await waitFor(() => expect(first.result.current.isCatalogLoading).toBe(false));
  await act(async () => {
    first.result.current.setSelectedModel("native-model");
    first.result.current.runtime.thread.composer.setText("Review this after reload");
  });
  first.unmount();
  await Promise.resolve();
  mockFetch.fetch.mockResolvedValueOnce(
    Response.json({
      harnesses: [
        {
          id: "codex",
          label: "Codex",
          available: true,
          models: [{ id: "native-model", label: "Native model", description: "Installed", metadata: {} }],
        },
      ],
    }),
  );
  mockFetch.fetch.mockResolvedValueOnce(Response.json({ sessions: [] }));
  const reloaded = renderHook(() => useAgentChat({ target: "project", pageURL }));
  expect(reloaded.result.current.runtime.thread.composer.getState().text).toBe("Review this after reload");
  expect(reloaded.result.current.selectedModel).toBe("native-model");
  await waitFor(() => expect(reloaded.result.current.isCatalogLoading).toBe(false));
  expect(sockets.connections).toHaveLength(0);
  expect(mockFetch.fetch).toHaveBeenCalledTimes(4);
});

test.each([{ sessions: [] }, { sessions: [{ ...session, status: "closed", nativeSessionId: "native-history" }] }])(
  "reload drops a missing or closed saved session without restarting a native process: %j",
  async ({ sessions }) => {
    const pageURL = "https://app.localhost/stale-session";
    const first = renderHook(() => useAgentChat({ target: "project", pageURL }));
    await waitFor(() => expect(first.result.current.isCatalogLoading).toBe(false));
    await act(async () => {
      first.result.current.settingsStore
        .getState()
        .updateChat({ sessionId: session.id, draft: "Still unsent", scroll: { top: 450, left: 0, isAtBottom: false } });
    });
    first.unmount();
    await Promise.resolve();
    mockFetch.fetch.mockResolvedValueOnce(
      Response.json({ harnesses: [{ id: "codex", label: "Codex", available: true, models: [] }] }),
    );
    mockFetch.fetch.mockResolvedValueOnce(Response.json({ sessions }));
    const reloaded = renderHook(() => useAgentChat({ target: "project", pageURL }));
    await waitFor(() => expect(reloaded.result.current.isCatalogLoading).toBe(false));
    expect(reloaded.result.current.settingsStore.getState().chat.sessionId).toBeNull();
    expect(reloaded.result.current.settingsStore.getState().chat.scroll).toBeNull();
    expect(reloaded.result.current.runtime.thread.composer.getState().text).toBe("Still unsent");
    expect(sockets.connections).toHaveLength(0);
    expect(mockFetch.fetch).toHaveBeenCalledTimes(4);
  },
);

test("a catalog refresh replaces an unavailable model preference with the configured default", async () => {
  const hook = renderHook(() => useAgentChat({ target: "project", pageURL: "https://app.localhost/retired-model" }));
  await waitFor(() => expect(hook.result.current.isCatalogLoading).toBe(false));
  await act(async () => {
    hook.result.current.setSelectedModel("retired-model");
  });
  mockFetch.fetch.mockResolvedValueOnce(
    Response.json({ harnesses: [{ id: "codex", label: "Codex", available: true, models: [] }] }),
  );
  mockFetch.fetch.mockResolvedValueOnce(Response.json({ sessions: [] }));
  await act(async () => {
    await hook.result.current.refreshCatalog();
  });
  expect(hook.result.current.selectedModel).toBe("");
  expect(hook.result.current.settingsStore.getState().chat.selectedModel).toBe("");
});

test("a disposed catalog request cannot erase settings saved by a later page", async () => {
  const catalog = Promise.withResolvers<Response>();
  mockFetch.fetch.mockReset();
  mockFetch.fetch.mockReturnValueOnce(catalog.promise);
  mockFetch.fetch.mockResolvedValueOnce(Response.json({ sessions: [] }));
  const hook = renderHook(() => useAgentChat({ target: "project", pageURL: "https://app.localhost/disposed" }));
  const settings = hook.result.current.settingsStore;
  hook.unmount();
  await Promise.resolve();
  settings.getState().updateChat({ sessionId: "newer-page-session", draft: "Keep newer draft" });
  await act(async () => {
    catalog.resolve(Response.json({ harnesses: [] }));
    await catalog.promise;
  });
  expect(settings.getState().chat.sessionId).toBe("newer-page-session");
  expect(settings.getState().chat.draft).toBe("Keep newer draft");
});

test("reload reattaches the saved session and receives history without replaying commands", async () => {
  const pageURL = "https://app.localhost/restore-session";
  const first = renderHook(() => useAgentChat({ target: "project", pageURL }));
  await waitFor(() => expect(first.result.current.isCatalogLoading).toBe(false));
  let resumed: Promise<void> | undefined;
  await act(async () => {
    resumed = first.result.current.resumeSession(session);
  });
  await waitFor(() => expect(sockets.connections).toHaveLength(1));
  await act(async () => {
    sockets.connections[0]?.send({ type: "snapshot", sessionId: session.id, session, pendingRequestIds: [] });
    await resumed;
  });
  first.unmount();
  await Promise.resolve();
  mockFetch.fetch.mockResolvedValueOnce(
    Response.json({ harnesses: [{ id: "codex", label: "Codex", available: true, models: [] }] }),
  );
  mockFetch.fetch.mockResolvedValueOnce(Response.json({ sessions: [session] }));
  const reloaded = renderHook(() => useAgentChat({ target: "project", pageURL }));
  await waitFor(() => expect(sockets.connections).toHaveLength(2));
  await act(async () => {
    sockets.connections[1]?.send({
      type: "snapshot",
      sessionId: session.id,
      session,
      events: [
        {
          sequence: 1,
          payload: {
            method: "item/completed",
            params: {
              item: { type: "agentMessage", id: "replayed", text: "Saved conversation" },
            },
          },
        },
      ],
      pendingRequestIds: [],
    });
  });
  expect(reloaded.result.current.session?.id).toBe(session.id);
  expect(reloaded.result.current.runtime.thread.getState().messages).toMatchObject([{ id: "replayed" }]);
  expect(reloaded.result.current.isHistoryReady).toBe(true);
  expect(sockets.connections[1]?.readSentFrames()).toEqual([]);
  expect(mockFetch.fetch).toHaveBeenCalledTimes(4);
});
afterEach(async () => {
  cleanup();
  await Promise.resolve();
  sockets.restore();
  mockFetch.restore();
  vi.useRealTimers();
});

test("server rejection restores the native composer draft using the matching command ID", async () => {
  const onSent = vi.fn();
  const hook = renderHook(() => useAgentChat({ target: "project", pageURL: "https://app.localhost/page", onSent }));
  await waitFor(() => expect(hook.result.current.isCatalogLoading).toBe(false));
  mockFetch.fetch.mockResolvedValueOnce(Response.json(session));
  await act(async () => {
    hook.result.current.runtime.thread.composer.setText("Keep rejected request");
    await hook.result.current.runtime.thread.composer.send();
  });
  await waitFor(() => expect(sockets.connections).toHaveLength(1));
  const connection = sockets.connections[0];
  await act(async () => {
    connection?.send({ type: "snapshot", sessionId: session.id, session, events: [], pendingRequestIds: [] });
  });
  await waitFor(() => expect(connection?.readSentFrames()).toHaveLength(1));
  expect(hook.result.current.settingsStore.getState().chat.draft).toBe("Keep rejected request");
  const sent = z.object({ commandId: z.string() }).parse(JSON.parse(String(connection?.readSentFrames()[0])));
  await act(async () => {
    connection?.send({ type: "command_result", sessionId: session.id, commandId: "stale-command", error: "Stale" });
  });
  expect(hook.result.current.sendError).toBeNull();
  await act(async () => {
    connection?.send({
      type: "command_result",
      sessionId: session.id,
      commandId: sent.commandId,
      error: "Invalid image",
    });
  });
  await waitFor(() =>
    expect(hook.result.current.runtime.thread.composer.getState().text).toBe("Keep rejected request"),
  );
  expect(hook.result.current.sendError).toBe("Invalid image");
  expect(hook.result.current.settingsStore.getState().chat.draft).toBe("Keep rejected request");
  expect(onSent).not.toHaveBeenCalled();
});

test("oversized UTF-8 context preserves the draft before creating a session", async () => {
  const hook = renderHook(() =>
    useAgentChat({
      target: "project",
      pageURL: "https://app.localhost/page",
      beforeSend: () => ({ text: "界".repeat(3 * 1024 * 1024) }),
    }),
  );
  await waitFor(() => expect(hook.result.current.isCatalogLoading).toBe(false));
  await act(async () => {
    hook.result.current.runtime.thread.composer.setText("Keep large capture");
    await hook.result.current.runtime.thread.composer.send();
  });
  await waitFor(() => expect(hook.result.current.sendError).toContain("8 MiB"));
  expect(hook.result.current.runtime.thread.composer.getState().text).toBe("Keep large capture");
  expect(mockFetch.fetch).toHaveBeenCalledTimes(2);
  expect(sockets.connections).toHaveLength(0);
});

test("native composer invokes capture before session HTTP, sends prepared context and receives actual frames", async () => {
  const sequence: string[] = [];
  const onSent = vi.fn();
  const hook = renderHook(() =>
    useAgentChat({
      target: "project",
      pageURL: "https://app.localhost/page",
      onSent,
      beforeSend: (text) => {
        sequence.push("capture");
        return { text: `Context\n${text}`, images: [{ dataURL: "data:image/png;base64,cGl4ZWw=" }] };
      },
    }),
  );
  await waitFor(() => expect(hook.result.current.isCatalogLoading).toBe(false));
  expect(hook.result.current.harnesses[0]?.models[0]?.metadata).toEqual({ supportedReasoningEfforts: ["high"] });
  mockFetch.fetch.mockImplementationOnce(async () => {
    sequence.push("session-http");
    return Response.json(session);
  });
  await act(async () => {
    hook.result.current.runtime.thread.composer.setText("Inspect this");
    await hook.result.current.runtime.thread.composer.send();
  });
  await waitFor(() => expect(sockets.connections).toHaveLength(1));
  expect(sequence).toEqual(["capture", "session-http"]);
  expect(onSent).not.toHaveBeenCalled();
  const connection = sockets.connections[0];
  expect(connection).toBeDefined();
  await act(async () => {
    connection?.send({ type: "snapshot", sessionId: session.id, session, events: [], pendingRequestIds: [] });
  });
  await waitFor(() => expect(connection?.readSentFrames()).toHaveLength(1));
  expect(JSON.parse(String(connection?.readSentFrames()[0]))).toEqual({
    type: "send",
    commandId: expect.any(String),
    model: "",
    text: "Context\nInspect this",
    images: [{ dataURL: "data:image/png;base64,cGl4ZWw=" }],
  });
  const sent = z.object({ commandId: z.string() }).parse(JSON.parse(String(connection?.readSentFrames()[0])));
  await act(async () => {
    connection?.send({ type: "command_result", sessionId: session.id, commandId: sent.commandId });
    connection?.send({
      type: "event",
      sessionId: session.id,
      sequence: 1,
      payload: {
        method: "item/completed",
        params: {
          threadId: "thread",
          turnId: "turn",
          item: { id: "answer", type: "agentMessage", text: "Native response" },
        },
      },
    });
  });
  await waitFor(() =>
    expect(hook.result.current.runtime.thread.getState().messages).toMatchObject([
      { content: [{ type: "text", text: "Native response" }] },
    ]),
  );
  expect(hook.result.current.settingsStore.getState().chat.draft).toBe("");
  hook.unmount();
  expect(onSent).toHaveBeenCalledOnce();
  await act(async () => {});
  expect(connection?.readClientClosure()?.code).toBe(1000);
});

test("cancelled native capture retains composer draft without creating a session", async () => {
  const hook = renderHook(() =>
    useAgentChat({ target: "project", pageURL: "https://app.localhost/page", beforeSend: () => null }),
  );
  await waitFor(() => expect(hook.result.current.isCatalogLoading).toBe(false));
  await act(async () => {
    hook.result.current.runtime.thread.composer.setText("Keep my draft");
    await hook.result.current.runtime.thread.composer.send();
  });
  await waitFor(() => expect(hook.result.current.runtime.thread.composer.getState().text).toBe("Keep my draft"));
  expect(mockFetch.fetch).toHaveBeenCalledTimes(2);
  expect(sockets.connections).toHaveLength(0);
  expect(hook.result.current.sendError).toContain("cancelled");
});

test("snapshot pending IDs gate exact native responses and ignore stale session traffic", async () => {
  const hook = renderHook(() => useAgentChat({ target: "project", pageURL: "https://app.localhost/page" }));
  await waitFor(() => expect(hook.result.current.isCatalogLoading).toBe(false));
  let resumed: Promise<void> | undefined;
  await act(async () => {
    resumed = hook.result.current.resumeSession(session);
  });
  await waitFor(() => expect(sockets.connections).toHaveLength(1));
  const connection = sockets.connections[0];
  const request = {
    id: 4,
    method: "item/commandExecution/requestApproval",
    params: { itemId: "command", command: "pwd" },
  };
  await act(async () => {
    connection?.send({
      type: "snapshot",
      sessionId: session.id,
      session,
      events: [{ sequence: 1, payload: request }],
      pendingRequestIds: [4],
    });
    await resumed;
  });
  expect(hook.result.current.pendingRequests).toMatchObject([{ requestId: 4, payload: request }]);
  await act(async () => {
    hook.result.current.respond(4, { decision: "decline" });
  });
  expect(JSON.parse(String(connection?.readSentFrames()[0]))).toEqual({
    type: "respond",
    requestId: 4,
    result: { decision: "decline" },
  });
  await act(async () => {
    connection?.send({ type: "state", sessionId: session.id, session, pendingRequestIds: [] });
    connection?.send({ type: "event", sessionId: "other-session", sequence: 2, payload: { method: "item/completed" } });
  });
  expect(hook.result.current.pendingRequests).toEqual([]);
  expect(hook.result.current.events).toHaveLength(1);
  expect(() => hook.result.current.respond(4, { decision: "accept" })).toThrow("no longer pending");
});
test("choosing another harness starts its own session before sending", async () => {
  const hook = renderHook(() => useAgentChat({ target: "project", pageURL: "https://app.localhost/page" }));
  await waitFor(() => expect(hook.result.current.isCatalogLoading).toBe(false));
  let resumed: Promise<void> | undefined;
  await act(async () => {
    resumed = hook.result.current.resumeSession(session);
  });
  await waitFor(() => expect(sockets.connections).toHaveLength(1));
  await act(async () => {
    sockets.connections[0]?.send({ type: "snapshot", sessionId: session.id, session, pendingRequestIds: [] });
    await resumed;
  });
  const claudeSession: IChatSession = { ...session, id: "chat-claude", harness: "claude-code" };
  mockFetch.fetch.mockResolvedValueOnce(Response.json(claudeSession));
  await act(async () => {
    hook.result.current.setSelectedHarness("claude-code");
  });
  await act(async () => {
    hook.result.current.runtime.thread.composer.setText("Claude request");
    await hook.result.current.runtime.thread.composer.send();
  });
  await waitFor(() => expect(sockets.connections).toHaveLength(2));
  await act(async () => {
    sockets.connections[1]?.send({
      type: "snapshot",
      sessionId: claudeSession.id,
      session: claudeSession,
      pendingRequestIds: [],
    });
  });
  await waitFor(() => expect(sockets.connections[1]?.readSentFrames()).toHaveLength(1));
  expect(sockets.connections[0]?.readSentFrames()).toEqual([]);
  expect(JSON.parse(String(mockFetch.fetch.mock.calls[2]?.[1]?.body))).toMatchObject({ harness: "claude-code" });
});
test("failed session creation reports the backend error and returns the native draft", async () => {
  const hook = renderHook(() => useAgentChat({ target: "project", pageURL: "https://app.localhost/page" }));
  await waitFor(() => expect(hook.result.current.isCatalogLoading).toBe(false));
  mockFetch.fetch.mockResolvedValueOnce(new Response("Codex is unavailable", { status: 502 }));
  await act(async () => {
    hook.result.current.runtime.thread.composer.setText("Retry this later");
    await hook.result.current.runtime.thread.composer.send();
  });
  await waitFor(() => expect(hook.result.current.sendError).toBe("Codex is unavailable"));
  await waitFor(() => expect(hook.result.current.runtime.thread.composer.getState().text).toBe("Retry this later"));
  expect(sockets.connections).toHaveLength(0);
});
test("reconnection adopts the authoritative snapshot and stops reconnecting after unmount", async () => {
  const hook = renderHook(() => useAgentChat({ target: "project", pageURL: "https://app.localhost/page" }));
  await waitFor(() => expect(hook.result.current.isCatalogLoading).toBe(false));
  let resumed: Promise<void> | undefined;
  await act(async () => {
    resumed = hook.result.current.resumeSession(session);
  });
  await waitFor(() => expect(sockets.connections).toHaveLength(1));
  await act(async () => {
    sockets.connections[0]?.send({ type: "snapshot", sessionId: session.id, session, pendingRequestIds: [] });
    await resumed;
  });
  vi.useFakeTimers();
  await act(async () => {
    sockets.connections[0]?.close(1006);
  });
  expect(hook.result.current.isConnected).toBe(false);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(sockets.connections).toHaveLength(2);
  await act(async () => {
    sockets.connections[1]?.send({
      type: "snapshot",
      sessionId: session.id,
      session,
      events: [
        {
          sequence: 3,
          payload: {
            method: "item/completed",
            params: { item: { type: "agentMessage", id: "restored", text: "Recovered" } },
          },
        },
      ],
      pendingRequestIds: [],
    });
  });
  expect(hook.result.current.isConnected).toBe(true);
  expect(hook.result.current.runtime.thread.getState().messages).toMatchObject([{ id: "restored" }]);
  await act(async () => {
    sockets.connections[1]?.close(1006);
  });
  hook.unmount();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10000);
  });
  expect(sockets.connections).toHaveLength(2);
});
test("catalog errors are visible and a later refresh recovers native model metadata", async () => {
  mockFetch.fetch.mockReset();
  mockFetch.fetch.mockResolvedValueOnce(new Response("Project unavailable", { status: 404 }));
  mockFetch.fetch.mockResolvedValueOnce(Response.json({ sessions: [] }));
  const hook = renderHook(() => useAgentChat({ target: "project", pageURL: "https://app.localhost/page" }));
  await waitFor(() => expect(hook.result.current.catalogError).toBe("Project unavailable"));
  mockFetch.fetch.mockResolvedValueOnce(
    Response.json({
      harnesses: [
        { id: "claude-code", label: "Claude Code", available: true, models: [], error: "Authentication required" },
      ],
    }),
  );
  mockFetch.fetch.mockResolvedValueOnce(Response.json({ sessions: [] }));
  await act(async () => {
    await hook.result.current.refreshCatalog();
  });
  expect(hook.result.current.catalogError).toBeNull();
  expect(hook.result.current.selectedHarness).toBe("claude-code");
  expect(hook.result.current.harnesses[0]?.error).toBe("Authentication required");
});
test("a closed session resumes its native ID through a new provider process", async () => {
  const hook = renderHook(() => useAgentChat({ target: "project", pageURL: "https://app.localhost/page" }));
  await waitFor(() => expect(hook.result.current.isCatalogLoading).toBe(false));
  mockFetch.fetch.mockResolvedValueOnce(Response.json({ ...session, id: "resumed-session" }));
  let resumed: Promise<void> | undefined;
  await act(async () => {
    resumed = hook.result.current.resumeSession({ ...session, status: "closed", nativeSessionId: "native-history" });
  });
  await waitFor(() => expect(sockets.connections).toHaveLength(1));
  expect(JSON.parse(String(mockFetch.fetch.mock.calls[2]?.[1]?.body))).toMatchObject({
    harness: "codex",
    pageURL: "https://app.localhost/page",
    resumeId: "native-history",
  });
  await act(async () => {
    sockets.connections[0]?.send({
      type: "snapshot",
      sessionId: "resumed-session",
      session: { ...session, id: "resumed-session" },
      pendingRequestIds: [],
    });
    await resumed;
  });
  expect(hook.result.current.session?.id).toBe("resumed-session");
});
test("failed close retains the current session and reports the failure through the controller", async () => {
  const hook = renderHook(() => useAgentChat({ target: "project", pageURL: "https://app.localhost/page" }));
  await waitFor(() => expect(hook.result.current.isCatalogLoading).toBe(false));
  let resumed: Promise<void> | undefined;
  await act(async () => {
    resumed = hook.result.current.resumeSession(session);
  });
  await waitFor(() => expect(sockets.connections).toHaveLength(1));
  await act(async () => {
    sockets.connections[0]?.send({ type: "snapshot", sessionId: session.id, session, pendingRequestIds: [] });
    await resumed;
  });
  mockFetch.fetch.mockResolvedValueOnce(new Response("Unable to stop native process", { status: 502 }));
  await act(async () => {
    await hook.result.current.closeSession();
  });
  expect(hook.result.current.session?.id).toBe(session.id);
  expect(hook.result.current.sendError).toBe("Unable to stop native process");
  expect(sockets.connections[0]?.readClientClosure()).toBeNull();
});
test("failed resume reports the native connection error without an unhandled rejection", async () => {
  const hook = renderHook(() => useAgentChat({ target: "project", pageURL: "https://app.localhost/page" }));
  await waitFor(() => expect(hook.result.current.isCatalogLoading).toBe(false));
  let resumed: Promise<void> | undefined;
  await act(async () => {
    resumed = hook.result.current.resumeSession(session);
  });
  await waitFor(() => expect(sockets.connections).toHaveLength(1));
  await act(async () => {
    sockets.connections[0]?.send({ type: "error", sessionId: session.id, error: "Native session unavailable" });
    await resumed;
  });
  expect(hook.result.current.sendError).toBe("Native session unavailable");
  expect(hook.result.current.isConnecting).toBe(false);
});

test("an acknowledged model choice can reset to the configured default in the same native session", async () => {
  const hook = renderHook(() => useAgentChat({ target: "project", pageURL: "https://app.localhost/page" }));
  await waitFor(() => expect(hook.result.current.isCatalogLoading).toBe(false));
  let resumed: Promise<void> | undefined;
  await act(async () => {
    resumed = hook.result.current.resumeSession(session);
  });
  await waitFor(() => expect(sockets.connections).toHaveLength(1));
  const connection = sockets.connections[0];
  await act(async () => {
    connection?.send({ type: "snapshot", sessionId: session.id, session, events: [], pendingRequestIds: [] });
    await resumed;
    hook.result.current.setSelectedModel("native-model");
  });
  await act(async () => {
    hook.result.current.runtime.thread.composer.setText("Use the selected model");
    await hook.result.current.runtime.thread.composer.send();
  });
  await waitFor(() => expect(connection?.readSentFrames()).toHaveLength(1));
  const selected = z
    .object({ commandId: z.string(), model: z.string(), text: z.string() })
    .parse(JSON.parse(String(connection?.readSentFrames()[0])));
  expect(selected.model).toBe("native-model");
  expect(selected.text).toBe("Use the selected model");
  await act(async () => {
    connection?.send({ type: "command_result", sessionId: session.id, commandId: selected.commandId });
  });
  await act(async () => {
    hook.result.current.setSelectedModel("");
  });
  await act(async () => {
    hook.result.current.runtime.thread.composer.setText("Use configured default");
    await hook.result.current.runtime.thread.composer.send();
  });
  await waitFor(() => expect(connection?.readSentFrames()).toHaveLength(2));
  const reset = z
    .object({ commandId: z.string(), model: z.string(), text: z.string() })
    .parse(JSON.parse(String(connection?.readSentFrames()[1])));
  expect(reset.model).toBe("");
  expect(reset.text).toBe("Use configured default");
  expect(reset.commandId).not.toBe(selected.commandId);
  await act(async () => {
    connection?.send({ type: "command_result", sessionId: session.id, commandId: reset.commandId });
  });
  expect(hook.result.current.sendError).toBeNull();
  expect(sockets.connections).toHaveLength(1);
  expect(mockFetch.fetch).toHaveBeenCalledTimes(2);
});

test.each(["project", "devhost"] as const)(
  "catalog, sessions, native attachment and close carry the page and the %s chat target",
  async (target) => {
    const pageURL = "https://app.localhost/project/page?filter=active";
    const hook = renderHook(() => useAgentChat({ target, pageURL }));
    await waitFor(() => expect(hook.result.current.isCatalogLoading).toBe(false));
    const catalogURL = new URL(String(mockFetch.fetch.mock.calls[0]?.[0]), window.location.href);
    expect(catalogURL.pathname).toBe("/__devhost__/chat/harnesses");
    expect(catalogURL.searchParams.get("chatTarget")).toBe(target);
    const listURL = new URL(String(mockFetch.fetch.mock.calls[1]?.[0]), window.location.href);
    expect(listURL.pathname).toBe("/__devhost__/chat/sessions");
    expect(listURL.searchParams.get("pageURL")).toBe(pageURL);
    expect(listURL.searchParams.get("chatTarget")).toBe(target);
    let resumed: Promise<void> | undefined;
    await act(async () => {
      resumed = hook.result.current.resumeSession(session);
    });
    await waitFor(() => expect(sockets.connections).toHaveLength(1));
    const connection = sockets.connections[0];
    expect(connection?.url.searchParams.get("pageURL")).toBe(pageURL);
    expect(connection?.url.searchParams.get("chatTarget")).toBe(target);
    expect(connection?.url.searchParams.get("sessionId")).toBe(session.id);
    await act(async () => {
      connection?.send({ type: "snapshot", sessionId: session.id, session, events: [], pendingRequestIds: [] });
      await resumed;
    });
    mockFetch.fetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await act(async () => {
      hook.result.current.settingsStore.getState().updateChat({ scroll: { top: 400, left: 0, isAtBottom: false } });
      await hook.result.current.closeSession();
    });
    const closeURL = new URL(String(mockFetch.fetch.mock.calls[2]?.[0]), window.location.href);
    expect(closeURL.pathname).toBe("/__devhost__/chat/sessions/chat-one");
    expect(closeURL.searchParams.get("pageURL")).toBe(pageURL);
    expect(closeURL.searchParams.get("chatTarget")).toBe(target);
    expect(mockFetch.fetch.mock.calls[2]?.[1]?.method).toBe("DELETE");
    expect(hook.result.current.session).toBeNull();
    expect(hook.result.current.settingsStore.getState().chat.sessionId).toBeNull();
    expect(hook.result.current.settingsStore.getState().chat.scroll).toBeNull();
    mockFetch.fetch.mockResolvedValueOnce(Response.json(session));
    await act(async () => {
      void hook.result.current.newSession();
    });
    await waitFor(() => expect(mockFetch.fetch.mock.calls[3]?.[1]?.method).toBe("POST"));
    expect(JSON.parse(String(mockFetch.fetch.mock.calls[3]?.[1]?.body))).toMatchObject({ pageURL, target });
  },
);
