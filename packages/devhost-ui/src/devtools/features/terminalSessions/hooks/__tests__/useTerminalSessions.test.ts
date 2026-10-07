import { act, renderHook } from "@testing-library/react";
import { afterEach, assert, beforeEach, describe, expect, test } from "vitest";

import { installMockFetch, type IInstalledMockFetch } from "../../../../../../test-support/installMockFetch";
import type { DevtoolsColorScheme } from "../../../../shared/DevtoolsColorScheme";
import type { IAnnotationAction } from "../../../../shared/devtoolsConfig";
import type { IAnnotationSubmitDetail } from "../../../annotationComposer/types";
import type { ComponentSourceMenuItem } from "../../../componentSourceNavigation/types";
import type { ActiveTerminalSessionSnapshot, TerminalSession } from "../../types";
import { useTerminalSessions } from "../useTerminalSessions";

interface ITerminalSessionsProps {
  colorScheme: DevtoolsColorScheme;
  enabled: boolean;
}

interface IListedSession {
  isExpanded: boolean;
  kind: TerminalSession["kind"];
  label: string;
  sessionId: string;
  status: TerminalSession["status"];
}

const agentAction: IAnnotationAction = { id: "agent", kind: "agent", label: "Pi", queueEnabled: true };
const ticketAction: IAnnotationAction = { id: "ticket", kind: "command", label: "Create Ticket", queueEnabled: false };
const annotation: IAnnotationSubmitDetail = {
  comment: "Tighten the header spacing",
  markers: [],
  stackName: "shop",
  submittedAt: 1,
  title: "Checkout",
  url: "https://shop.localhost/checkout",
};
const buttonMenuItem: ComponentSourceMenuItem = {
  action: { kind: "neovim" },
  displayName: "Button",
  key: "src/components/Button.tsx:48:9:0",
  props: [],
  source: { columnNumber: 9, fileName: "/projects/shop/src/components/Button.tsx", lineNumber: 48 },
  sourceLabel: "src/components/Button.tsx:48:9",
};
const jsonHeaders: Record<string, string> = { "content-type": "application/json" };

let mockFetch: IInstalledMockFetch;

function readListedSessions(sessions: TerminalSession[]): IListedSession[] {
  return sessions.map((session: TerminalSession): IListedSession => {
    return {
      isExpanded: session.isExpanded,
      kind: session.kind,
      label: session.summary.chipLabel,
      sessionId: session.sessionId,
      status: session.status,
    };
  });
}

/** Mounts the hook against a server that still runs `restoredSessions`, and waits for it to list them. */
async function mountSessions(restoredSessions: ActiveTerminalSessionSnapshot[] = []) {
  mockFetch.fetch.mockResolvedValueOnce(Response.json({ sessions: restoredSessions }));

  const hook = renderHook((props: ITerminalSessionsProps) => useTerminalSessions(props.colorScheme, props.enabled), {
    initialProps: { colorScheme: "dark", enabled: true },
  });

  await act(async (): Promise<void> => {});
  mockFetch.fetch.mockClear();

  return hook;
}

/** The JSON body of the `index`th request the hook has made since it mounted. */
function readRequestBody(index: number): unknown {
  const body: unknown = mockFetch.fetch.mock.calls[index]?.[1]?.body;

  assert(typeof body === "string");

  return JSON.parse(body);
}

beforeEach(() => {
  mockFetch = installMockFetch();
});

afterEach(() => {
  mockFetch.restore();
});

describe("useTerminalSessions", () => {
  test("lists the sessions the server still runs, minimized, when it mounts", async () => {
    mockFetch.fetch.mockResolvedValueOnce(
      Response.json({
        sessions: [
          { label: "Pi", request: { actionId: "agent", annotation, kind: "agent" }, sessionId: "session-1" },
          {
            label: "Create Ticket",
            request: { actionId: "ticket", annotation, kind: "command" },
            sessionId: "session-2",
          },
        ],
      }),
    );

    const hook = renderHook(() => useTerminalSessions("dark"));

    expect(hook.result.current.terminalSessions).toEqual([]);
    await act(async (): Promise<void> => {});

    expect(mockFetch.fetch.mock.calls).toEqual([["/__devhost__/terminal-sessions", { method: "GET" }]]);
    expect(readListedSessions(hook.result.current.terminalSessions)).toEqual([
      { isExpanded: false, kind: "command", label: "Create Ticket", sessionId: "session-2", status: "connecting" },
      { isExpanded: false, kind: "agent", label: "Pi", sessionId: "session-1", status: "connecting" },
    ]);
  });

  test("keeps a session started before the server's list arrived as it is, and lists it once", async () => {
    const list = Promise.withResolvers<Response>();

    mockFetch.fetch.mockReturnValueOnce(list.promise);
    const hook = renderHook(() => useTerminalSessions("dark"));

    mockFetch.fetch.mockResolvedValueOnce(Response.json({ sessionId: "session-2" }));
    await act(() => hook.result.current.submitAnnotation(annotation, agentAction));
    act(() => hook.result.current.expandSession("session-2"));

    await act(async (): Promise<void> => {
      list.resolve(
        Response.json({
          sessions: [
            {
              label: "Create Ticket",
              request: { actionId: "ticket", annotation, kind: "command" },
              sessionId: "session-1",
            },
            { label: "Pi", request: { actionId: "agent", annotation, kind: "agent" }, sessionId: "session-2" },
          ],
        }),
      );
    });

    expect(readListedSessions(hook.result.current.terminalSessions)).toEqual([
      { isExpanded: true, kind: "agent", label: "Pi", sessionId: "session-2", status: "connecting" },
      { isExpanded: false, kind: "command", label: "Create Ticket", sessionId: "session-1", status: "connecting" },
    ]);
  });

  test("starts with no sessions when the server's list cannot be read", async () => {
    mockFetch.fetch.mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    const refusedHook = renderHook(() => useTerminalSessions("dark"));

    await act(async (): Promise<void> => {});
    expect(refusedHook.result.current.terminalSessions).toEqual([]);
    refusedHook.unmount();

    mockFetch.fetch.mockResolvedValueOnce(Response.json({ sessions: [{ sessionId: "session-1" }] }));
    const malformedHook = renderHook(() => useTerminalSessions("dark"));

    await act(async (): Promise<void> => {});
    expect(malformedHook.result.current.terminalSessions).toEqual([]);
    malformedHook.unmount();

    mockFetch.fetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const unreachableHook = renderHook(() => useTerminalSessions("dark"));

    await act(async (): Promise<void> => {});
    expect(unreachableHook.result.current.terminalSessions).toEqual([]);
  });

  test("asks the server for nothing and starts nothing while disabled", async () => {
    const hook = renderHook(() => useTerminalSessions("dark", false));

    await act(async (): Promise<void> => {});

    expect(await act(() => hook.result.current.submitAnnotation(annotation, agentAction))).toEqual({
      errorMessage: "Terminal sessions are not supported by this runtime.",
      success: false,
    });
    expect(mockFetch.fetch).toHaveBeenCalledTimes(0);
    expect(hook.result.current.terminalSessions).toEqual([]);
  });

  test("drops its sessions when it is disabled", async () => {
    const hook = await mountSessions([
      { label: "Pi", request: { actionId: "agent", annotation, kind: "agent" }, sessionId: "session-1" },
    ]);

    expect(hook.result.current.terminalSessions).toHaveLength(1);

    hook.rerender({ colorScheme: "dark", enabled: false });
    expect(hook.result.current.terminalSessions).toEqual([]);
  });

  test("submitAnnotation starts an agent session in the current color scheme and lists it", async () => {
    const hook = await mountSessions();

    mockFetch.fetch.mockResolvedValueOnce(Response.json({ sessionId: "session-1" }));
    expect(await act(() => hook.result.current.submitAnnotation(annotation, agentAction))).toEqual({ success: true });

    expect(mockFetch.fetch.mock.calls.map((call) => [call[0], call[1]?.method, call[1]?.headers])).toEqual([
      ["/__devhost__/terminal-sessions", "POST", jsonHeaders],
    ]);
    expect(readRequestBody(0)).toEqual({ actionId: "agent", annotation, colorScheme: "dark", kind: "agent" });
    expect(readListedSessions(hook.result.current.terminalSessions)).toEqual([
      { isExpanded: false, kind: "agent", label: "Pi", sessionId: "session-1", status: "connecting" },
    ]);

    hook.rerender({ colorScheme: "light", enabled: true });
    mockFetch.fetch.mockResolvedValueOnce(Response.json({ sessionId: "session-1" }));
    await act(() => hook.result.current.submitAnnotation(annotation, agentAction, "session-1"));

    // A follow-up for a running session targets it, and the server answers with the same session.
    expect(readRequestBody(1)).toEqual({
      actionId: "agent",
      annotation,
      colorScheme: "light",
      kind: "agent",
      targetSessionId: "session-1",
    });
    expect(hook.result.current.terminalSessions).toHaveLength(1);
  });

  test("submitAnnotation starts a command session expanded, in front of the sessions already listed", async () => {
    const hook = await mountSessions();

    mockFetch.fetch.mockResolvedValueOnce(Response.json({ sessionId: "session-1" }));
    await act(() => hook.result.current.submitAnnotation(annotation, agentAction));
    act(() => hook.result.current.expandSession("session-1"));

    mockFetch.fetch.mockResolvedValueOnce(Response.json({ sessionId: "session-2" }));
    expect(await act(() => hook.result.current.submitAnnotation(annotation, ticketAction))).toEqual({ success: true });

    expect(readRequestBody(1)).toEqual({ actionId: "ticket", annotation, kind: "command" });
    expect(readListedSessions(hook.result.current.terminalSessions)).toEqual([
      { isExpanded: true, kind: "command", label: "Create Ticket", sessionId: "session-2", status: "connecting" },
      { isExpanded: false, kind: "agent", label: "Pi", sessionId: "session-1", status: "connecting" },
    ]);
  });

  test("reports why a session did not start and lists nothing for it", async () => {
    const hook = await mountSessions();

    mockFetch.fetch.mockResolvedValueOnce(new Response("The agent is not installed.", { status: 500 }));
    expect(await act(() => hook.result.current.submitAnnotation(annotation, agentAction))).toEqual({
      errorMessage: "The agent is not installed.",
      success: false,
    });

    mockFetch.fetch.mockResolvedValueOnce(Response.json({ sessionId: "" }));
    expect(await act(() => hook.result.current.submitAnnotation(annotation, agentAction))).toEqual({
      errorMessage: "Terminal session start returned an invalid response.",
      success: false,
    });

    mockFetch.fetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await act(() => hook.result.current.submitAnnotation(annotation, agentAction))).toEqual({
      errorMessage: "Failed to fetch",
      success: false,
    });

    expect(hook.result.current.terminalSessions).toEqual([]);
  });

  test("startComponentSourceSession starts a Neovim session for the component on this page", async () => {
    const hook = await mountSessions();

    mockFetch.fetch.mockResolvedValueOnce(Response.json({ sessionId: "session-1" }));
    expect(await act(() => hook.result.current.startComponentSourceSession(buttonMenuItem))).toEqual({
      success: true,
    });

    expect(readRequestBody(0)).toEqual({
      componentName: "Button",
      kind: "editor",
      launcher: "neovim",
      pageUrl: window.location.href,
      source: buttonMenuItem.source,
      sourceLabel: "src/components/Button.tsx:48:9",
    });
    expect(readListedSessions(hook.result.current.terminalSessions)).toEqual([
      { isExpanded: true, kind: "editor", label: "<Button>", sessionId: "session-1", status: "connecting" },
    ]);
  });

  test("expands one session at a time, minimizes, updates status, and removes sessions", async () => {
    const hook = await mountSessions([
      { label: "Pi", request: { actionId: "agent", annotation, kind: "agent" }, sessionId: "session-1" },
      { label: "Create Ticket", request: { actionId: "ticket", annotation, kind: "command" }, sessionId: "session-2" },
    ]);
    const readExpandedIds = (): string[] => {
      return hook.result.current.terminalSessions
        .filter((session: TerminalSession): boolean => session.isExpanded)
        .map((session: TerminalSession): string => session.sessionId);
    };

    act(() => hook.result.current.expandSession("session-1"));
    expect(readExpandedIds()).toEqual(["session-1"]);

    act(() => hook.result.current.expandSession("session-2"));
    expect(readExpandedIds()).toEqual(["session-2"]);

    act(() => hook.result.current.expandSession("unknown"));
    expect(readExpandedIds()).toEqual(["session-2"]);

    act(() => hook.result.current.minimizeSession("session-2"));
    expect(readExpandedIds()).toEqual([]);

    act(() => hook.result.current.updateSessionStatus("session-1", "error", "The connection was lost."));
    expect(
      hook.result.current.terminalSessions.map((session: TerminalSession) => [
        session.sessionId,
        session.status,
        session.errorMessage,
      ]),
    ).toEqual([
      ["session-2", "connecting", null],
      ["session-1", "error", "The connection was lost."],
    ]);

    act(() => hook.result.current.removeSession("session-2"));
    expect(readListedSessions(hook.result.current.terminalSessions)).toEqual([
      { isExpanded: false, kind: "agent", label: "Pi", sessionId: "session-1", status: "error" },
    ]);
  });

  test("registerStartedSession lists a session started elsewhere, once", async () => {
    const hook = await mountSessions();

    act(() => {
      hook.result.current.registerStartedSession({
        label: "Pi",
        request: { actionId: "agent", annotation, kind: "agent" },
        sessionId: "session-7",
      });
      hook.result.current.registerStartedSession({
        label: "Create Ticket",
        request: { actionId: "ticket", annotation, kind: "command" },
        sessionId: "session-7",
      });
    });

    expect(readListedSessions(hook.result.current.terminalSessions)).toEqual([
      { isExpanded: false, kind: "agent", label: "Pi", sessionId: "session-7", status: "connecting" },
    ]);
    expect(mockFetch.fetch).toHaveBeenCalledTimes(0);
  });
});
