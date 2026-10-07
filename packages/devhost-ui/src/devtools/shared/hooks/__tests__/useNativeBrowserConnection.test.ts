import { disposeHookTransport, hookTransport } from "./helpers";
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { useNativeBrowserConnection } from "../useNativeBrowserConnection";

interface IHookProps {
  isEnabled: boolean;
}

afterEach(async () => {
  cleanup();
  await waitFor(() => expect(hookTransport.readActiveSockets()).toBe(0));
  hookTransport.reset();
});
afterAll(disposeHookTransport);

describe("useNativeBrowserConnection genuine transport lifetime", () => {
  test("disabled hook makes no request, then connects and releases the owned socket on disable", async () => {
    const hook = renderHook(({ isEnabled }: IHookProps) => useNativeBrowserConnection(isEnabled), {
      initialProps: { isEnabled: false },
    });
    await act(async () => {
      await hook.result.current.connect();
    });
    expect(hookTransport.configurationRequests).toHaveLength(0);
    expect(hookTransport.requests).toHaveLength(0);
    hook.rerender({ isEnabled: true });
    await act(async () => {
      await hook.result.current.connect();
    });
    await waitFor(() => expect(hook.result.current.view.connectionStatus).toBe("connected"));
    expect(hookTransport.requests[0].command).toBe("connect");
    expect(hookTransport.configurationRequests).toHaveLength(1);
    const documentId = hookTransport.requests[0].binding.documentId;
    hook.rerender({ isEnabled: false });
    await waitFor(() => expect(hookTransport.readClosedSockets()).toBe(1));
    expect(hook.result.current.view.connectionStatus).toBe("disconnected");
    await act(async () => {
      await hook.result.current.connect();
    });
    expect(hookTransport.configurationRequests).toHaveLength(1);
    hook.rerender({ isEnabled: true });
    await act(async () => {
      await hook.result.current.connect();
    });
    await waitFor(() => expect(hook.result.current.view.connectionStatus).toBe("connected"));
    expect(hookTransport.requests[1].binding.documentId).not.toBe(documentId);
    expect(hookTransport.configurationRequests).toHaveLength(2);
    hook.unmount();
    await waitFor(() => expect(hookTransport.readClosedSockets()).toBe(2));
  });

  test("StrictMode reconnects its live owner and disconnect/open commands use that owner", async () => {
    const hook = renderHook(() => useNativeBrowserConnection(true), { wrapper: StrictMode });
    await act(async () => {
      await hook.result.current.connect();
    });
    await waitFor(() => expect(hook.result.current.view.connectionStatus).toBe("connected"));
    expect(hookTransport.readActiveSockets()).toBe(1);
    expect(hookTransport.configurationRequests).toHaveLength(1);
    act(() => hook.result.current.openReact());
    await waitFor(() => expect(hookTransport.requests).toHaveLength(2));
    expect(hookTransport.requests[1].command).toBe("open-react");
    expect(hookTransport.requests[1].binding).toEqual(hookTransport.requests[0].binding);
    expect(hook.result.current.view.isActionPending).toBe(true);
    act(() => hookTransport.acknowledgeAction(1, 2));
    await waitFor(() => expect(hook.result.current.view.isActionPending).toBe(false));
    act(() => hook.result.current.disconnect());
    await waitFor(() => expect(hookTransport.readClosedSockets()).toBe(1));
    expect(hook.result.current.view.connectionStatus).toBe("disconnected");
    await act(async () => {
      await hook.result.current.connect();
    });
    await waitFor(() => expect(hook.result.current.view.connectionStatus).toBe("connected"));
    expect(hookTransport.readActiveSockets()).toBe(1);
    hook.unmount();
    await waitFor(() => expect(hookTransport.readClosedSockets()).toBe(2));
  });

  test("observed session loss survives disable/re-enable and prevents a returning open action", async () => {
    const hook = renderHook(({ isEnabled }: IHookProps) => useNativeBrowserConnection(isEnabled), {
      initialProps: { isEnabled: true },
    });
    await act(async () => {
      await hook.result.current.connect();
    });
    await waitFor(() => expect(hook.result.current.view.connectionStatus).toBe("connected"));
    act(() => hookTransport.sendObservation(2, { isNativeSessionLost: true, isReactAvailable: false }));
    await waitFor(() => expect(hook.result.current.view.observation?.isNativeSessionLost).toBe(true));
    expect(hook.result.current.view.observation?.isReactAvailable).toBe(false);
    hook.rerender({ isEnabled: false });
    await waitFor(() => expect(hookTransport.readClosedSockets()).toBe(1));
    hook.rerender({ isEnabled: true });
    await act(async () => {
      await hook.result.current.connect();
    });
    await waitFor(() => expect(hook.result.current.view.connectionStatus).toBe("connected"));
    expect(hook.result.current.view.observation?.isNativeSessionLost).toBe(true);
    expect(hook.result.current.view.observation?.isReactAvailable).toBe(false);
    act(() => hook.result.current.openReact());
    expect(hookTransport.requests.map((request) => request.command)).toEqual(["connect", "connect"]);
    hook.unmount();
    await waitFor(() => expect(hookTransport.readClosedSockets()).toBe(2));
  });
});
