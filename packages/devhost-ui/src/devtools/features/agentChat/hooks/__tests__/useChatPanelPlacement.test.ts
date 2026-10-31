import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "vitest";
import { installMockFetch, type IInstalledMockFetch } from "../../../../../../test-support/installMockFetch";
import { useChatPanelPlacement } from "../useChatPanelPlacement";

let mockFetch: IInstalledMockFetch;

beforeEach(() => {
  mockFetch = installMockFetch();
});
afterEach(() => {
  mockFetch.restore();
});

function answerSavedPosition(position: unknown): void {
  mockFetch.fetch.mockImplementation(async () => Response.json({ position }));
}

test("starts at the dock when nothing is saved", async () => {
  answerSavedPosition(null);
  const hook = renderHook(() => useChatPanelPlacement({ isOpen: true }));
  await waitFor(() => expect(mockFetch.fetch).toHaveBeenCalled());
  expect(hook.result.current.panelStyle).toBeUndefined();
  expect(hook.result.current.isMoved).toBe(false);
  expect(hook.result.current.canMove).toBe(true);
  hook.unmount();
});

test("restores the saved position", async () => {
  answerSavedPosition({ left: 40, top: 60 });
  const hook = renderHook(() => useChatPanelPlacement({ isOpen: true }));
  await waitFor(() => expect(hook.result.current.isMoved).toBe(true));
  expect(hook.result.current.panelStyle).toMatchObject({ left: 40, top: 60, right: "auto", bottom: "auto" });
  hook.unmount();
});

test("keeps the dock when a session has no saved layout", async () => {
  mockFetch.fetch.mockImplementation(async () => new Response(null, { status: 404 }));
  const hook = renderHook(() => useChatPanelPlacement({ isOpen: true }));
  await waitFor(() => expect(mockFetch.fetch).toHaveBeenCalled());
  await act(async () => {
    await Promise.resolve();
  });
  expect(hook.result.current.isMoved).toBe(false);
  hook.unmount();
});

test("resetting clears the position on the server", async () => {
  answerSavedPosition({ left: 40, top: 60 });
  const hook = renderHook(() => useChatPanelPlacement({ isOpen: true }));
  await waitFor(() => expect(hook.result.current.isMoved).toBe(true));
  await act(async () => {
    hook.result.current.resetPosition();
  });
  expect(hook.result.current.isMoved).toBe(false);
  const saved = mockFetch.fetch.mock.calls.at(-1)?.[1];
  expect(saved?.method).toBe("PUT");
  expect(JSON.parse(String(saved?.body))).toEqual({ position: null });
  hook.unmount();
});
