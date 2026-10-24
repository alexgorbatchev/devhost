import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useRecovery } from "../useRecovery";
import { createRecoveryFixture } from "./helpers";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

test("polls status and logs, retains the error title while probing, and reloads only after a successful probe", async () => {
  const { state, client } = createRecoveryFixture();
  const hook = renderHook(() => useRecovery(state, client));
  await act(async () => {});
  expect(hook.result.current.isConnected).toBe(true);
  client.readStatus.mockResolvedValue({ ...state, phase: "ready", title: "", message: "", logs: ["ready"] });
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(hook.result.current.state.title).toBe("web exited");
  expect(hook.result.current.state.logs).toEqual(["ready"]);
  expect(client.reload).not.toHaveBeenCalled();
  client.probe.mockResolvedValue(true);
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(client.reload).toHaveBeenCalledTimes(1);
});

test("disables controls during disconnection and resumes polling after a failure", async () => {
  const { state, client } = createRecoveryFixture();
  client.readStatus.mockRejectedValueOnce(new Error("Disconnected"));
  const hook = renderHook(() => useRecovery(state, client));
  await act(async () => {});
  expect(hook.result.current.isConnected).toBe(false);
  expect(hook.result.current.state.message).toBe("Disconnected");
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(hook.result.current.isConnected).toBe(true);
  expect(hook.result.current.state.message).toBe("Exit code 1");
});

test("serializes mutations, shows failure, and allows retry without replaying actions", async () => {
  const { state, client } = createRecoveryFixture();
  const response = Promise.withResolvers<void>();
  client.restart.mockReturnValueOnce(response.promise);
  const hook = renderHook(() => useRecovery(state, client));
  await act(async () => {});
  let pending: Promise<void> | undefined;
  await act(async () => {
    pending = hook.result.current.restart();
  });
  expect(hook.result.current.isBusy).toBe(true);
  await act(() => hook.result.current.select({ repositoryId: "repo", path: "/next" }));
  expect(client.switchWorktree).not.toHaveBeenCalled();
  await act(async () => {
    response.reject(new Error("Port busy"));
    await pending;
  });
  expect(hook.result.current.error).toBe("Port busy");
  expect(hook.result.current.isBusy).toBe(false);
  await act(() => hook.result.current.restart());
  expect(hook.result.current.error).toBe("");
  expect(client.restart).toHaveBeenCalledTimes(2);
});

test("refreshes checkout ownership, posts selections, and reloads only on success", async () => {
  const { state, client } = createRecoveryFixture();
  const repositories = [{ id: "repo", name: "shop", selectedPath: "/main", switching: false, worktrees: [] }];
  state.repositories = repositories;
  client.readWorktrees.mockResolvedValue(repositories);
  const hook = renderHook(() => useRecovery(state, client));
  await act(async () => {});
  expect(hook.result.current.hasWorktrees).toBe(true);
  await act(() => hook.result.current.refresh());
  expect(client.readWorktrees).toHaveBeenCalledTimes(2);
  client.switchWorktree.mockRejectedValueOnce(new Error("Ownership changed"));
  const selection = { repositoryId: "repo", path: "/next", stopOwnerId: "owner" };
  await act(() => hook.result.current.select(selection));
  expect(hook.result.current.error).toBe("Ownership changed");
  expect(client.reload).not.toHaveBeenCalled();
  await act(() => hook.result.current.select(selection));
  expect(client.switchWorktree).toHaveBeenLastCalledWith(selection, expect.any(AbortSignal));
  expect(client.reload).toHaveBeenCalledTimes(1);
});

test("unmount aborts in-flight reads and mutations and prevents future polling or navigation", async () => {
  const { state, client } = createRecoveryFixture();
  const response = Promise.withResolvers<void>();
  client.restart.mockReturnValue(response.promise);
  const hook = renderHook(() => useRecovery(state, client));
  await act(async () => {});
  let pending: Promise<void> | undefined;
  await act(async () => {
    pending = hook.result.current.restart();
  });
  const signal = client.restart.mock.calls[0]?.[0];
  hook.unmount();
  expect(signal?.aborted).toBe(true);
  await act(async () => {
    response.resolve();
    await pending;
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(client.readStatus).toHaveBeenCalledTimes(1);
  expect(client.reload).not.toHaveBeenCalled();
});

test("a probe started before a restart cannot navigate after that restart fails", async () => {
  const { state, client } = createRecoveryFixture();
  client.readStatus.mockResolvedValue({ ...state, phase: "ready" });
  const probe = Promise.withResolvers<boolean>();
  client.probe.mockReturnValueOnce(probe.promise);
  const hook = renderHook(() => useRecovery(state, client));
  await act(async () => {});
  expect(client.probe).toHaveBeenCalledTimes(1);
  client.restart.mockRejectedValueOnce(new Error("Restart failed"));
  await act(() => hook.result.current.restart());
  await act(async () => {
    probe.resolve(true);
  });
  expect(hook.result.current.error).toBe("Restart failed");
  expect(client.reload).not.toHaveBeenCalled();
});
