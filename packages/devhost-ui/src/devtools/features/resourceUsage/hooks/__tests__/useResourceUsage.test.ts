import { act, renderHook, type RenderHookResult } from "@testing-library/react";
import { afterEach, assert, beforeEach, describe, expect, test, vi } from "vitest";

import type { IMockWebSocketConnection } from "../../../../../../test-support/createMockWebSocket";
import {
  installMockWebSocket,
  type IInstalledMockWebSocket,
} from "../../../../../../test-support/installMockWebSocket";
import type { IResourceUsage } from "../../types";
import { useResourceUsage } from "../useResourceUsage";

type ServerAction = () => void;

interface IResourceUsageProps {
  isEnabled: boolean;
}

interface IConnectedResourceUsage {
  connection: IMockWebSocketConnection;
  hook: RenderHookResult<IResourceUsage | null, IResourceUsageProps>;
}

const calmUsage: IResourceUsage = {
  cpu: { cores: 8, percent: 18 },
  disk: { percent: 41, totalBytes: 512_000_000_000, usedBytes: 212_000_000_000 },
  memory: { percent: 31, totalBytes: 32_000_000_000, usedBytes: 9_800_000_000 },
};
const busyUsage: IResourceUsage = { ...calmUsage, cpu: { cores: 8, percent: 96 } };

let webSocket: IInstalledMockWebSocket;

// Lets the socket's queued open or close run, and applies the state updates a server action causes.
async function settle(action?: ServerAction): Promise<void> {
  await act(async (): Promise<void> => {
    action?.();
  });
}

function renderResourceUsage(isEnabled: boolean): IConnectedResourceUsage["hook"] {
  return renderHook((props: IResourceUsageProps): IResourceUsage | null => useResourceUsage(props.isEnabled), {
    initialProps: { isEnabled },
  });
}

async function connectResourceUsage(): Promise<IConnectedResourceUsage> {
  const hook = renderResourceUsage(true);

  await settle();

  const connection: IMockWebSocketConnection | undefined = webSocket.connections.at(0);

  assert(connection !== undefined);

  return { connection, hook };
}

beforeEach(() => {
  webSocket = installMockWebSocket();
});

afterEach(() => {
  vi.useRealTimers();
  webSocket.restore();
});

describe("useResourceUsage", () => {
  test("opens one usage stream on the current host and has no readings before the first message", async () => {
    const { connection, hook } = await connectResourceUsage();

    expect(connection.url.href).toBe(`ws://${window.location.host}/__devhost__/ws/resources`);
    expect(hook.result.current).toBeNull();

    hook.rerender({ isEnabled: true });
    await settle();
    expect(webSocket.connections).toHaveLength(1);
  });

  test("replaces its readings with each message", async () => {
    const { connection, hook } = await connectResourceUsage();

    await settle(() => connection.send(calmUsage));
    expect(hook.result.current).toEqual(calmUsage);

    await settle(() => connection.send(busyUsage));
    expect(hook.result.current).toEqual(busyUsage);

    await settle(() => connection.send({ cpu: busyUsage.cpu }));
    expect(hook.result.current).toEqual({ cpu: busyUsage.cpu });
  });

  test("keeps its readings when a frame is not a usage message", async () => {
    const { connection, hook } = await connectResourceUsage();

    await settle(() => connection.send(calmUsage));
    await settle(() => {
      connection.sendFrame(new ArrayBuffer(1));
      connection.sendFrame("{");
      connection.send({ cpu: "busy" });
    });

    expect(hook.result.current).toEqual(calmUsage);
  });

  test("opens no stream while resources are off", async () => {
    const hook = renderResourceUsage(false);

    await settle();

    expect(webSocket.attemptCount).toBe(0);
    expect(hook.result.current).toBeNull();
  });

  test("closes the stream and drops its readings when resources are turned off", async () => {
    const { connection, hook } = await connectResourceUsage();

    await settle(() => connection.send(calmUsage));
    hook.rerender({ isEnabled: false });
    await settle();

    expect(connection.readClientClosure()).toEqual({ code: 1000, reason: "devtools unmounted" });
    expect(hook.result.current).toBeNull();
  });

  test("drops stale readings while the stream is down and shows those of the reopened stream", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { connection, hook } = await connectResourceUsage();

    await settle(() => connection.send(calmUsage));
    await settle(() => connection.close(1006));
    expect(hook.result.current).toBeNull();

    await settle(() => vi.advanceTimersByTime(1_000));

    const reopened: IMockWebSocketConnection | undefined = webSocket.connections.at(1);

    assert(reopened !== undefined);
    expect(reopened.url.href).toBe(connection.url.href);

    await settle(() => reopened.send(busyUsage));
    expect(hook.result.current).toEqual(busyUsage);
  });

  test("closes the stream when it unmounts", async () => {
    const { connection, hook } = await connectResourceUsage();

    expect(connection.readClientClosure()).toBeNull();

    hook.unmount();
    expect(connection.readClientClosure()).toEqual({ code: 1000, reason: "devtools unmounted" });
  });
});
