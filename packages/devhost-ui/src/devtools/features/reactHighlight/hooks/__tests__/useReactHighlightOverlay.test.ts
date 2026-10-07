// `./helpers` registers the DOM globals and must load before Testing Library.
import { createOverlayRoot, ReactHighlightLifecycleController, readOverlayLocators, unregisterDom } from "./helpers";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, renderHook, type RenderHookResult } from "@testing-library/react";
import type { RefObject } from "react";

import { useReactHighlightOverlay } from "../useReactHighlightOverlay";

type HookAction = () => void;

interface IOverlayHookProps {
  enabled: boolean;
  overlayRootReference: RefObject<HTMLElement | null>;
  projectRootPath: string;
}

function renderOverlayHook(
  controller: ReactHighlightLifecycleController,
  initialProps: IOverlayHookProps,
): RenderHookResult<void, IOverlayHookProps> {
  return renderHook(
    (props: IOverlayHookProps): void => {
      useReactHighlightOverlay({
        ...props,
        createWebSocket: controller.createWebSocket,
        highlightElements: controller.highlightElements,
      });
    },
    { initialProps },
  );
}

// Highlight results arrive through promises, so their continuations run before the next assertion.
async function settle(action: HookAction): Promise<void> {
  await act(async (): Promise<void> => {
    action();
  });
}

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

afterAll(async () => {
  await unregisterDom();
});

describe("useReactHighlightOverlay", () => {
  test("shows the latest cursor, ignores invalid messages, and clears on a null locator", async () => {
    const controller = new ReactHighlightLifecycleController();
    const overlayRoot = createOverlayRoot();
    const hook = renderOverlayHook(controller, {
      enabled: true,
      overlayRootReference: { current: overlayRoot },
      projectRootPath: "/configured-project",
    });

    expect(controller.sockets).toHaveLength(1);
    await settle(() => controller.sendInvalidMessages());
    expect(controller.requestSummaries).toEqual([]);

    await settle(() => controller.sendCursor("src/First.tsx:10:5"));
    expect(readOverlayLocators(overlayRoot)).toEqual(["src/First.tsx:10:5"]);
    expect(controller.requestSummaries).toEqual([
      { locator: "src/First.tsx:10:5", projectRootPath: "/message-project" },
    ]);

    await settle(() => controller.sendCursor("src/Second.tsx:20:5"));
    expect(readOverlayLocators(overlayRoot)).toEqual(["src/Second.tsx:20:5"]);

    await settle(() => controller.sendInvalidMessages());
    expect(readOverlayLocators(overlayRoot)).toEqual(["src/Second.tsx:20:5"]);
    expect(controller.requestSummaries).toHaveLength(2);

    await settle(() => controller.sendCursor(null));
    expect(readOverlayLocators(overlayRoot)).toEqual([]);
    expect(controller.sockets).toHaveLength(1);

    hook.unmount();
    expect(controller.closedConnectionCount).toBe(1);
  });

  test("connects only while enabled and stops listening once disabled", async () => {
    const controller = new ReactHighlightLifecycleController();
    const overlayRoot = createOverlayRoot();
    const props: IOverlayHookProps = {
      enabled: false,
      overlayRootReference: { current: overlayRoot },
      projectRootPath: "/configured-project",
    };
    const hook = renderOverlayHook(controller, props);

    expect(controller.sockets).toHaveLength(0);

    hook.rerender({ ...props, enabled: true });
    expect(controller.sockets).toHaveLength(1);
    await settle(() => controller.sendCursor("src/First.tsx:10:5"));
    expect(readOverlayLocators(overlayRoot)).toEqual(["src/First.tsx:10:5"]);

    hook.rerender({ ...props, enabled: false });
    expect(controller.closedConnectionCount).toBe(1);
    expect(readOverlayLocators(overlayRoot)).toEqual([]);

    await settle(() => controller.sendCursor("src/First.tsx:10:5", "", 0));
    expect(controller.requestSummaries).toHaveLength(1);
    expect(readOverlayLocators(overlayRoot)).toEqual([]);
  });

  test("reconnects when the project changes and falls back to the configured project root", async () => {
    const controller = new ReactHighlightLifecycleController();
    const overlayRoot = createOverlayRoot();
    const props: IOverlayHookProps = {
      enabled: true,
      overlayRootReference: { current: overlayRoot },
      projectRootPath: "/configured-project",
    };
    const hook = renderOverlayHook(controller, props);

    await settle(() => controller.sendCursor("src/First.tsx:10:5", ""));
    expect(readOverlayLocators(overlayRoot)).toEqual(["src/First.tsx:10:5"]);

    hook.rerender({ ...props, projectRootPath: "/other-project" });
    expect(controller.sockets).toHaveLength(2);
    expect(controller.closedConnectionCount).toBe(1);
    expect(readOverlayLocators(overlayRoot)).toEqual([]);

    await settle(() => controller.sendCursor("src/First.tsx:10:5", "", 0));
    expect(controller.requestSummaries).toHaveLength(1);

    await settle(() => controller.sendCursor("src/First.tsx:10:5", ""));
    expect(readOverlayLocators(overlayRoot)).toEqual(["src/First.tsx:10:5"]);
    expect(controller.requestSummaries).toEqual([
      { locator: "src/First.tsx:10:5", projectRootPath: "/configured-project" },
      { locator: "src/First.tsx:10:5", projectRootPath: "/other-project" },
    ]);
    expect(controller.sockets.map((socket) => new URL(socket.url).search)).toEqual(["", ""]);
    expect(controller.sockets.map((socket) => new URL(socket.url).host)).toEqual([
      window.location.host,
      window.location.host,
    ]);

    hook.rerender({ ...props, enabled: false, projectRootPath: "/other-project" });
    expect(controller.sockets).toHaveLength(2);
    expect(controller.closedConnectionCount).toBe(2);
    expect(readOverlayLocators(overlayRoot)).toEqual([]);
  });

  test("ignores cursors while the overlay root is missing", async () => {
    const controller = new ReactHighlightLifecycleController();
    const overlayRoot = createOverlayRoot();
    const props: IOverlayHookProps = {
      enabled: true,
      overlayRootReference: { current: null },
      projectRootPath: "/configured-project",
    };
    const hook = renderOverlayHook(controller, props);

    await settle(() => controller.sendCursor("src/First.tsx:10:5"));
    expect(controller.requestSummaries).toEqual([]);
    expect(readOverlayLocators(overlayRoot)).toEqual([]);

    hook.rerender({ ...props, overlayRootReference: { current: overlayRoot } });
    await settle(() => controller.sendCursor("src/First.tsx:10:5"));
    expect(readOverlayLocators(overlayRoot)).toEqual(["src/First.tsx:10:5"]);

    hook.unmount();
    expect(controller.closedConnectionCount).toBe(2);
    expect(readOverlayLocators(overlayRoot)).toEqual([]);
  });

  test("keeps the newest cursor when older results resolve later", async () => {
    const controller = new ReactHighlightLifecycleController(true);
    const overlayRoot = createOverlayRoot();
    const hook = renderOverlayHook(controller, {
      enabled: true,
      overlayRootReference: { current: overlayRoot },
      projectRootPath: "/configured-project",
    });

    await settle(() => controller.sendCursor("src/First.tsx:10:5"));
    await settle(() => controller.sendCursor("src/Second.tsx:20:5"));
    expect(controller.requestSummaries).toHaveLength(2);
    expect(readOverlayLocators(overlayRoot)).toEqual([]);

    await settle(() => controller.resolveRequest(1));
    expect(readOverlayLocators(overlayRoot)).toEqual(["src/Second.tsx:20:5"]);

    await settle(() => controller.resolveRequest(0));
    expect(readOverlayLocators(overlayRoot)).toEqual(["src/Second.tsx:20:5"]);

    hook.unmount();
    expect(readOverlayLocators(overlayRoot)).toEqual([]);
    expect(controller.closedConnectionCount).toBe(1);
  });

  test("removes results that resolve after cleanup or after the cursor was cleared", async () => {
    const controller = new ReactHighlightLifecycleController(true);
    const overlayRoot = createOverlayRoot();
    const props: IOverlayHookProps = {
      enabled: true,
      overlayRootReference: { current: overlayRoot },
      projectRootPath: "/configured-project",
    };
    const firstHook = renderOverlayHook(controller, props);

    await settle(() => controller.sendCursor("src/First.tsx:10:5"));
    firstHook.unmount();
    expect(controller.closedConnectionCount).toBe(1);

    await settle(() => controller.resolveRequest(0));
    expect(readOverlayLocators(overlayRoot)).toEqual([]);

    await settle(() => controller.sendCursor("src/First.tsx:10:5", "", 0));
    expect(controller.requestSummaries).toHaveLength(1);

    renderOverlayHook(controller, props);
    await settle(() => controller.sendCursor("src/Second.tsx:20:5"));
    await settle(() => controller.sendCursor(null));
    await settle(() => controller.resolveRequest(1));
    expect(readOverlayLocators(overlayRoot)).toEqual([]);
    expect(controller.sockets).toHaveLength(2);
  });

  test("a remounted hook opens a new connection and the old one stays closed", async () => {
    const controller = new ReactHighlightLifecycleController();
    const overlayRoot = createOverlayRoot();
    const props: IOverlayHookProps = {
      enabled: true,
      overlayRootReference: { current: overlayRoot },
      projectRootPath: "/configured-project",
    };
    const firstHook = renderOverlayHook(controller, props);

    firstHook.unmount();
    await settle(() => controller.sendCursor("src/First.tsx:10:5", "", 0));
    expect(controller.requestSummaries).toEqual([]);

    const secondHook = renderOverlayHook(controller, props);
    expect(controller.sockets).toHaveLength(2);
    expect(controller.closedConnectionCount).toBe(1);

    await settle(() => controller.sendCursor("src/First.tsx:10:5"));
    expect(readOverlayLocators(overlayRoot)).toEqual(["src/First.tsx:10:5"]);

    secondHook.unmount();
    expect(controller.closedConnectionCount).toBe(2);
    expect(readOverlayLocators(overlayRoot)).toEqual([]);
  });
});
