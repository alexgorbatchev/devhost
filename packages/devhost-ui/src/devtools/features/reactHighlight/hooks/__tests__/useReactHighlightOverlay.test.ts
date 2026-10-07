import { act, renderHook, type RenderHookResult } from "@testing-library/react";
import type { RefObject } from "react";
import { afterEach, assert, beforeEach, describe, expect, test, vi } from "vitest";

import type { IMockWebSocketConnection } from "../../../../../../test-support/createMockWebSocket";
import {
  installMockWebSocket,
  type IInstalledMockWebSocket,
} from "../../../../../../test-support/installMockWebSocket";
import { useReactHighlightOverlay } from "../useReactHighlightOverlay";
import { createOverlayRoot, HighlightRenderer, readOverlayLocators, sendCursor, sendInvalidMessages } from "./helpers";

type HookAction = () => void;

interface IOverlayHookProps {
  enabled: boolean;
  overlayRootReference: RefObject<HTMLElement | null>;
  projectRootPath: string;
}

let webSocket: IInstalledMockWebSocket;

function renderOverlayHook(
  renderer: HighlightRenderer,
  initialProps: IOverlayHookProps,
): RenderHookResult<void, IOverlayHookProps> {
  return renderHook(
    (props: IOverlayHookProps): void => {
      useReactHighlightOverlay({ ...props, highlightElements: renderer.highlightElements });
    },
    { initialProps },
  );
}

// Lets a new socket open, and runs the continuations of highlight results before the next assertion.
async function settle(action?: HookAction): Promise<void> {
  await act(async (): Promise<void> => {
    action?.();
  });
}

function readConnection(index: number): IMockWebSocketConnection {
  const connection: IMockWebSocketConnection | undefined = webSocket.connections[index];

  assert(connection !== undefined);

  return connection;
}

function countClosedConnections(): number {
  return webSocket.connections.filter((connection: IMockWebSocketConnection): boolean => {
    return connection.readClientClosure() !== null;
  }).length;
}

beforeEach(() => {
  webSocket = installMockWebSocket();
});

afterEach(() => {
  vi.useRealTimers();
  webSocket.restore();
});

describe("useReactHighlightOverlay", () => {
  test("shows the latest cursor, ignores invalid messages, and clears on a null locator", async () => {
    const renderer = new HighlightRenderer();
    const overlayRoot = createOverlayRoot();
    const hook = renderOverlayHook(renderer, {
      enabled: true,
      overlayRootReference: { current: overlayRoot },
      projectRootPath: "/configured-project",
    });

    await settle();

    const connection = readConnection(0);

    expect(connection.url.href).toBe(`ws://${window.location.host}/__devhost__/ws/react-highlight`);
    await settle(() => sendInvalidMessages(connection));
    expect(renderer.requestSummaries).toEqual([]);

    await settle(() => sendCursor(connection, "src/First.tsx:10:5"));
    expect(readOverlayLocators(overlayRoot)).toEqual(["src/First.tsx:10:5"]);
    expect(renderer.requestSummaries).toEqual([{ locator: "src/First.tsx:10:5", projectRootPath: "/message-project" }]);

    await settle(() => sendCursor(connection, "src/Second.tsx:20:5"));
    expect(readOverlayLocators(overlayRoot)).toEqual(["src/Second.tsx:20:5"]);

    await settle(() => sendInvalidMessages(connection));
    expect(readOverlayLocators(overlayRoot)).toEqual(["src/Second.tsx:20:5"]);
    expect(renderer.requestSummaries).toHaveLength(2);

    await settle(() => sendCursor(connection, null));
    expect(readOverlayLocators(overlayRoot)).toEqual([]);
    expect(webSocket.connections).toHaveLength(1);

    hook.unmount();
    expect(connection.readClientClosure()).toEqual({ code: 1000, reason: "devtools unmounted" });
  });

  test("connects only while enabled and stops listening once disabled", async () => {
    const renderer = new HighlightRenderer();
    const overlayRoot = createOverlayRoot();
    const props: IOverlayHookProps = {
      enabled: false,
      overlayRootReference: { current: overlayRoot },
      projectRootPath: "/configured-project",
    };
    const hook = renderOverlayHook(renderer, props);

    await settle();
    expect(webSocket.connections).toHaveLength(0);

    hook.rerender({ ...props, enabled: true });
    await settle();

    const connection = readConnection(0);

    await settle(() => sendCursor(connection, "src/First.tsx:10:5"));
    expect(readOverlayLocators(overlayRoot)).toEqual(["src/First.tsx:10:5"]);

    hook.rerender({ ...props, enabled: false });
    // The socket is still closing, so a cursor that was already on its way arrives now.
    await settle(() => sendCursor(connection, "src/First.tsx:10:5", ""));
    expect(countClosedConnections()).toBe(1);
    expect(renderer.requestSummaries).toHaveLength(1);
    expect(readOverlayLocators(overlayRoot)).toEqual([]);
  });

  test("reconnects when the project changes and falls back to the configured project root", async () => {
    const renderer = new HighlightRenderer();
    const overlayRoot = createOverlayRoot();
    const props: IOverlayHookProps = {
      enabled: true,
      overlayRootReference: { current: overlayRoot },
      projectRootPath: "/configured-project",
    };
    const hook = renderOverlayHook(renderer, props);

    await settle();

    const firstConnection = readConnection(0);

    await settle(() => sendCursor(firstConnection, "src/First.tsx:10:5", ""));
    expect(readOverlayLocators(overlayRoot)).toEqual(["src/First.tsx:10:5"]);

    hook.rerender({ ...props, projectRootPath: "/other-project" });
    // A cursor still arriving on the connection being replaced is ignored.
    await settle(() => sendCursor(firstConnection, "src/First.tsx:10:5", ""));
    expect(readOverlayLocators(overlayRoot)).toEqual([]);
    expect(renderer.requestSummaries).toHaveLength(1);
    expect(webSocket.connections).toHaveLength(2);
    expect(countClosedConnections()).toBe(1);

    const secondConnection = readConnection(1);

    await settle(() => sendCursor(secondConnection, "src/First.tsx:10:5", ""));
    expect(readOverlayLocators(overlayRoot)).toEqual(["src/First.tsx:10:5"]);
    expect(renderer.requestSummaries).toEqual([
      { locator: "src/First.tsx:10:5", projectRootPath: "/configured-project" },
      { locator: "src/First.tsx:10:5", projectRootPath: "/other-project" },
    ]);
    expect(secondConnection.url.href).toBe(firstConnection.url.href);

    hook.rerender({ ...props, enabled: false, projectRootPath: "/other-project" });
    await settle();
    expect(webSocket.connections).toHaveLength(2);
    expect(countClosedConnections()).toBe(2);
    expect(readOverlayLocators(overlayRoot)).toEqual([]);
  });

  test("ignores cursors while the overlay root is missing", async () => {
    const renderer = new HighlightRenderer();
    const overlayRoot = createOverlayRoot();
    const props: IOverlayHookProps = {
      enabled: true,
      overlayRootReference: { current: null },
      projectRootPath: "/configured-project",
    };
    const hook = renderOverlayHook(renderer, props);

    await settle();
    await settle(() => sendCursor(readConnection(0), "src/First.tsx:10:5"));
    expect(renderer.requestSummaries).toEqual([]);
    expect(readOverlayLocators(overlayRoot)).toEqual([]);

    hook.rerender({ ...props, overlayRootReference: { current: overlayRoot } });
    await settle();
    await settle(() => sendCursor(readConnection(1), "src/First.tsx:10:5"));
    expect(readOverlayLocators(overlayRoot)).toEqual(["src/First.tsx:10:5"]);

    hook.unmount();
    expect(countClosedConnections()).toBe(2);
    expect(readOverlayLocators(overlayRoot)).toEqual([]);
  });

  test("keeps the newest cursor when older results resolve later", async () => {
    const renderer = new HighlightRenderer(true);
    const overlayRoot = createOverlayRoot();
    const hook = renderOverlayHook(renderer, {
      enabled: true,
      overlayRootReference: { current: overlayRoot },
      projectRootPath: "/configured-project",
    });

    await settle();

    const connection = readConnection(0);

    await settle(() => sendCursor(connection, "src/First.tsx:10:5"));
    await settle(() => sendCursor(connection, "src/Second.tsx:20:5"));
    expect(renderer.requestSummaries).toHaveLength(2);
    expect(readOverlayLocators(overlayRoot)).toEqual([]);

    await settle(() => renderer.resolveRequest(1));
    expect(readOverlayLocators(overlayRoot)).toEqual(["src/Second.tsx:20:5"]);

    await settle(() => renderer.resolveRequest(0));
    expect(readOverlayLocators(overlayRoot)).toEqual(["src/Second.tsx:20:5"]);

    hook.unmount();
    expect(readOverlayLocators(overlayRoot)).toEqual([]);
    expect(countClosedConnections()).toBe(1);
  });

  test("removes results that resolve after cleanup or after the cursor was cleared", async () => {
    const renderer = new HighlightRenderer(true);
    const overlayRoot = createOverlayRoot();
    const props: IOverlayHookProps = {
      enabled: true,
      overlayRootReference: { current: overlayRoot },
      projectRootPath: "/configured-project",
    };
    const firstHook = renderOverlayHook(renderer, props);

    await settle();
    await settle(() => sendCursor(readConnection(0), "src/First.tsx:10:5"));
    firstHook.unmount();
    expect(countClosedConnections()).toBe(1);

    await settle(() => renderer.resolveRequest(0));
    expect(readOverlayLocators(overlayRoot)).toEqual([]);

    renderOverlayHook(renderer, props);
    await settle();

    const secondConnection = readConnection(1);

    await settle(() => sendCursor(secondConnection, "src/Second.tsx:20:5"));
    await settle(() => sendCursor(secondConnection, null));
    await settle(() => renderer.resolveRequest(1));
    expect(readOverlayLocators(overlayRoot)).toEqual([]);
    expect(webSocket.connections).toHaveLength(2);
  });

  test("a remounted hook opens a new connection and the old one stays closed", async () => {
    const renderer = new HighlightRenderer();
    const overlayRoot = createOverlayRoot();
    const props: IOverlayHookProps = {
      enabled: true,
      overlayRootReference: { current: overlayRoot },
      projectRootPath: "/configured-project",
    };
    const firstHook = renderOverlayHook(renderer, props);

    await settle();

    const firstConnection = readConnection(0);

    firstHook.unmount();
    // The first connection is still closing, so this cursor reaches it and must be ignored.
    await settle(() => sendCursor(firstConnection, "src/First.tsx:10:5", ""));
    expect(renderer.requestSummaries).toEqual([]);

    const secondHook = renderOverlayHook(renderer, props);

    await settle();
    expect(webSocket.connections).toHaveLength(2);
    expect(countClosedConnections()).toBe(1);

    await settle(() => sendCursor(readConnection(1), "src/First.tsx:10:5"));
    expect(readOverlayLocators(overlayRoot)).toEqual(["src/First.tsx:10:5"]);

    secondHook.unmount();
    expect(countClosedConnections()).toBe(2);
    expect(readOverlayLocators(overlayRoot)).toEqual([]);
  });

  test("clears the highlight when the stream drops and follows the editor again once it reopens", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const renderer = new HighlightRenderer();
    const overlayRoot = createOverlayRoot();

    renderOverlayHook(renderer, {
      enabled: true,
      overlayRootReference: { current: overlayRoot },
      projectRootPath: "/configured-project",
    });
    await settle();

    const connection = readConnection(0);

    await settle(() => sendCursor(connection, "src/First.tsx:10:5"));
    expect(readOverlayLocators(overlayRoot)).toEqual(["src/First.tsx:10:5"]);

    // Nothing reports the editor's cursor while the stream is down, so the page stops showing the last one.
    await settle(() => connection.close(1006));
    expect(readOverlayLocators(overlayRoot)).toEqual([]);
    expect(webSocket.attemptCount).toBe(1);

    await settle(() => vi.advanceTimersByTime(1_000));

    const reopened = readConnection(1);

    expect(reopened.url.href).toBe(connection.url.href);
    await settle(() => sendCursor(reopened, "src/Second.tsx:20:5"));
    expect(readOverlayLocators(overlayRoot)).toEqual(["src/Second.tsx:20:5"]);
  });

  test("drops a highlight that resolves after the stream dropped", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const renderer = new HighlightRenderer(true);
    const overlayRoot = createOverlayRoot();

    renderOverlayHook(renderer, {
      enabled: true,
      overlayRootReference: { current: overlayRoot },
      projectRootPath: "/configured-project",
    });
    await settle();

    const connection = readConnection(0);

    await settle(() => sendCursor(connection, "src/First.tsx:10:5"));
    await settle(() => connection.close(1006));
    await settle(() => renderer.resolveRequest(0));

    expect(readOverlayLocators(overlayRoot)).toEqual([]);
  });

  test("stops reopening the stream once it unmounts", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const renderer = new HighlightRenderer();
    const hook = renderOverlayHook(renderer, {
      enabled: true,
      overlayRootReference: { current: createOverlayRoot() },
      projectRootPath: "/configured-project",
    });

    await settle();
    await settle(() => readConnection(0).close(1006));
    hook.unmount();
    await settle(() => vi.advanceTimersByTime(60_000));

    expect(webSocket.attemptCount).toBe(1);
  });
});
