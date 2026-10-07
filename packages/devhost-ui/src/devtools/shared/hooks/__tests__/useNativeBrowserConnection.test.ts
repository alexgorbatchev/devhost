import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, assert, describe, expect, test } from "vitest";

import type {
  INativeBrowserTransportState,
  NativeBrowserControlRequest,
} from "../../../../../test-support/nativeBrowserTransport";
import { useNativeBrowserConnection } from "../useNativeBrowserConnection";
import { hookTransport } from "./helpers";

interface IHookProps {
  isEnabled: boolean;
}

type TransportExpectation = (transport: INativeBrowserTransportState) => void;
type HookExpectation = () => void;
type TransportAction = () => Promise<void>;

// The transport runs in the test server's process, so the test waits until it has seen what the page did.
async function waitForTransport(expectation: TransportExpectation): Promise<INativeBrowserTransportState> {
  return await waitFor(async (): Promise<INativeBrowserTransportState> => {
    const transport: INativeBrowserTransportState = await hookTransport.read();

    expectation(transport);

    return transport;
  });
}

/**
 * Has the transport send something to the page and waits for the hook to show it. The wait starts first: the
 * message can reach the page before the command that sent it returns, and the hook's update must find the test
 * already waiting for it.
 */
async function waitForHookAfter(action: TransportAction, expectation: HookExpectation): Promise<void> {
  const shown: Promise<void> = waitFor(expectation);

  await action();
  await shown;
}

function readRequest(transport: INativeBrowserTransportState, index: number): NativeBrowserControlRequest {
  const request: NativeBrowserControlRequest | undefined = transport.requests[index];

  assert(request !== undefined);

  return request;
}

afterEach(async () => {
  await waitForTransport((transport) => expect(transport.activeSocketCount).toBe(0));
  await hookTransport.reset();
});

describe("useNativeBrowserConnection genuine transport lifetime", () => {
  test("disabled hook makes no request, then connects and releases the owned socket on disable", async () => {
    const hook = renderHook(({ isEnabled }: IHookProps) => useNativeBrowserConnection(isEnabled), {
      initialProps: { isEnabled: false },
    });
    await act(async () => {
      await hook.result.current.connect();
    });
    const idleTransport = await hookTransport.read();
    expect(idleTransport.configurationRequestCount).toBe(0);
    expect(idleTransport.requests).toHaveLength(0);
    hook.rerender({ isEnabled: true });
    await act(async () => {
      await hook.result.current.connect();
    });
    await waitFor(() => expect(hook.result.current.view.connectionStatus).toBe("connected"));
    const connectedTransport = await hookTransport.read();
    const firstRequest = readRequest(connectedTransport, 0);
    expect(firstRequest.command).toBe("connect");
    expect(firstRequest.binding.href).toBe(window.location.href);
    expect(connectedTransport.configurationRequestCount).toBe(1);
    hook.rerender({ isEnabled: false });
    await waitForTransport((transport) => expect(transport.closedSocketCount).toBe(1));
    expect(hook.result.current.view.connectionStatus).toBe("disconnected");
    await act(async () => {
      await hook.result.current.connect();
    });
    expect((await hookTransport.read()).configurationRequestCount).toBe(1);
    hook.rerender({ isEnabled: true });
    await act(async () => {
      await hook.result.current.connect();
    });
    await waitFor(() => expect(hook.result.current.view.connectionStatus).toBe("connected"));
    const reconnectedTransport = await hookTransport.read();
    expect(readRequest(reconnectedTransport, 1).binding.documentId).not.toBe(firstRequest.binding.documentId);
    expect(reconnectedTransport.configurationRequestCount).toBe(2);
    hook.unmount();
    await waitForTransport((transport) => expect(transport.closedSocketCount).toBe(2));
  });

  test("StrictMode reconnects its live owner and disconnect/open commands use that owner", async () => {
    const hook = renderHook(() => useNativeBrowserConnection(true), { wrapper: StrictMode });
    await act(async () => {
      await hook.result.current.connect();
    });
    await waitFor(() => expect(hook.result.current.view.connectionStatus).toBe("connected"));
    const connectedTransport = await hookTransport.read();
    expect(connectedTransport.activeSocketCount).toBe(1);
    expect(connectedTransport.configurationRequestCount).toBe(1);
    act(() => hook.result.current.openReact());
    const openedTransport = await waitForTransport((transport) => expect(transport.requests).toHaveLength(2));
    expect(readRequest(openedTransport, 1).command).toBe("open-react");
    expect(readRequest(openedTransport, 1).binding).toEqual(readRequest(openedTransport, 0).binding);
    expect(hook.result.current.view.isActionPending).toBe(true);
    await waitForHookAfter(
      () => hookTransport.acknowledgeAction(1, 2),
      () => expect(hook.result.current.view.isActionPending).toBe(false),
    );
    act(() => hook.result.current.disconnect());
    await waitForTransport((transport) => expect(transport.closedSocketCount).toBe(1));
    expect(hook.result.current.view.connectionStatus).toBe("disconnected");
    await act(async () => {
      await hook.result.current.connect();
    });
    await waitFor(() => expect(hook.result.current.view.connectionStatus).toBe("connected"));
    expect((await hookTransport.read()).activeSocketCount).toBe(1);
    hook.unmount();
    await waitForTransport((transport) => expect(transport.closedSocketCount).toBe(2));
  });

  test("observed session loss survives disable/re-enable and prevents a returning open action", async () => {
    const hook = renderHook(({ isEnabled }: IHookProps) => useNativeBrowserConnection(isEnabled), {
      initialProps: { isEnabled: true },
    });
    await act(async () => {
      await hook.result.current.connect();
    });
    await waitFor(() => expect(hook.result.current.view.connectionStatus).toBe("connected"));
    await waitForHookAfter(
      () => hookTransport.sendObservation(2, { isNativeSessionLost: true, isReactAvailable: false }),
      () => expect(hook.result.current.view.observation?.isNativeSessionLost).toBe(true),
    );
    expect(hook.result.current.view.observation?.isReactAvailable).toBe(false);
    hook.rerender({ isEnabled: false });
    await waitForTransport((transport) => expect(transport.closedSocketCount).toBe(1));
    hook.rerender({ isEnabled: true });
    await act(async () => {
      await hook.result.current.connect();
    });
    await waitFor(() => expect(hook.result.current.view.connectionStatus).toBe("connected"));
    expect(hook.result.current.view.observation?.isNativeSessionLost).toBe(true);
    expect(hook.result.current.view.observation?.isReactAvailable).toBe(false);
    act(() => hook.result.current.openReact());
    const transport = await hookTransport.read();
    expect(transport.requests.map((request) => request.command)).toEqual(["connect", "connect"]);
    hook.unmount();
    await waitForTransport((closedTransport) => expect(closedTransport.closedSocketCount).toBe(2));
  });
});
