import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, assert, beforeEach, expect, test, vi } from "vitest";
import { installMockFetch, type IInstalledMockFetch } from "../../../../../../test-support/installMockFetch";
import type { RunningAgent } from "../../../../shared/readRunningAgents";
import { AGENT_LIST_REFRESH_MS } from "../../constants";
import { useRunningAgents } from "../useRunningAgents";

const agent: RunningAgent = {
  key: "codex:1",
  harness: "codex",
  state: "working",
  subdirectory: ".",
  lastActivity: 1,
  isOwned: false,
};

let mockFetch: IInstalledMockFetch;
const answer = (agents: readonly RunningAgent[]): void => {
  mockFetch.fetch.mockImplementation(async () => Response.json({ agents }));
};
function setVisibility(state: DocumentVisibilityState): void {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue(state);
}

beforeEach(() => {
  mockFetch = installMockFetch();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  mockFetch.restore();
});

test("reads the checkout's agents for the chat target", async () => {
  answer([agent]);
  const hook = renderHook(() => useRunningAgents(true, "devhost"));
  await waitFor(() => expect(hook.result.current).toEqual([agent]));
  const url = new URL(String(mockFetch.fetch.mock.calls[0]?.[0]), window.location.href);
  assert(url.pathname === "/__devhost__/agents");
  expect(url.searchParams.get("chatTarget")).toBe("devhost");
  expect(url.searchParams.get("pageURL")).toBe(window.location.href);
  hook.unmount();
});

test("scans nothing while disabled", async () => {
  answer([agent]);
  const hook = renderHook(() => useRunningAgents(false, "project"));
  await act(async () => {
    await Promise.resolve();
  });
  expect(mockFetch.fetch).not.toHaveBeenCalled();
  expect(hook.result.current).toEqual([]);
  hook.unmount();
});

test("refreshes on an interval and stops when unmounted", async () => {
  vi.useFakeTimers();
  answer([]);
  const hook = renderHook(() => useRunningAgents(true, "project"));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(mockFetch.fetch).toHaveBeenCalledOnce();
  answer([agent]);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(AGENT_LIST_REFRESH_MS);
  });
  expect(hook.result.current).toEqual([agent]);
  hook.unmount();
  const scans = mockFetch.fetch.mock.calls.length;
  await vi.advanceTimersByTimeAsync(AGENT_LIST_REFRESH_MS * 2);
  expect(mockFetch.fetch).toHaveBeenCalledTimes(scans);
});

test("scans nothing while the page is hidden, and again once it shows", async () => {
  vi.useFakeTimers();
  setVisibility("hidden");
  answer([agent]);
  const hook = renderHook(() => useRunningAgents(true, "project"));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(AGENT_LIST_REFRESH_MS * 3);
  });
  expect(mockFetch.fetch).not.toHaveBeenCalled();
  setVisibility("visible");
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(hook.result.current).toEqual([agent]);
  hook.unmount();
});

test("keeps the last list when a scan fails", async () => {
  vi.useFakeTimers();
  answer([agent]);
  const hook = renderHook(() => useRunningAgents(true, "project"));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  mockFetch.fetch.mockImplementation(async () => new Response("no", { status: 500 }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(AGENT_LIST_REFRESH_MS);
  });
  expect(hook.result.current).toEqual([agent]);
  hook.unmount();
});
