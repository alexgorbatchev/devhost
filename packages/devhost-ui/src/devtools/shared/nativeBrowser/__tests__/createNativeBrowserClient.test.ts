import assert from "node:assert/strict";
import { expect, test } from "bun:test";
import { createTransportHarness, waitForNativeView } from "./helpers";
import { createNativeBrowserClient } from "../createNativeBrowserClient";

test("real transport correlates and serializes native actions for the exact document", async () => {
  const transport = createTransportHarness();
  try {
    await transport.client.connect();
    const connected = await waitForNativeView(transport.client, (view) => view.connectionStatus === "connected");
    assert(connected.binding);
    expect(transport.requests).toEqual([{ id: "connect_1", command: "connect", binding: connected.binding }]);
    expect(new URL(transport.configurationRequests[0]?.url ?? "").pathname).toBe("/__devhost__/config.json");
    transport.client.openReact();
    transport.client.openReact();
    const pending = await waitForNativeView(transport.client, (view) => view.isActionPending);
    expect(pending.observation?.isNativeWindowOpen).toBe(false);
    const open = await transport.waitForRequest(1);
    expect(transport.requests).toEqual([
      { id: "connect_1", command: "connect", binding: connected.binding },
      { id: "open_2", command: "open-react", binding: connected.binding },
    ]);
    transport.acknowledge({ ...open, id: "unknown" }, 2, { isNativeWindowOpen: true });
    transport.acknowledge(open, 2, { isNativeWindowOpen: true });
    const completed = await waitForNativeView(transport.client, (view) => !view.isActionPending);
    expect(completed.observation?.isNativeWindowOpen).toBe(true);
    expect(completed.connectionStatus).toBe("connected");
  } finally {
    await transport.dispose();
  }
});

test("a real configuration request that never responds has a bounded, released connection lifetime", async () => {
  const response = Promise.withResolvers<Response>();
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => response.promise });
  const client = createNativeBrowserClient({
    hasNativeSessionLoss: false,
    documentId: "11111111111111111111111111111111",
    fetch: globalThis.fetch,
    createSocket: (url, protocols) => new WebSocket(url, protocols),
    getHref: () => server.url.href,
  });
  const connection = client.connect();
  try {
    // Observe the actual 10-second production bound; there is no accelerated clock or delayed fake response.
    const failed = await waitForNativeView(client, (view) => view.errorMessage !== null, 12000);
    await connection;
    expect(failed.connectionStatus).toBe("disconnected");
    expect(failed.binding).toBeNull();
    expect(failed.errorMessage).toBe("Devhost configuration did not respond. The connection was released.");
  } finally {
    client.dispose();
    response.resolve(Response.json({}));
    await connection;
    await server.stop(true);
  }
}, 15000);

test("disconnect releases the real socket, and reconnect refreshes configuration without retaining old commands", async () => {
  const transport = createTransportHarness();
  try {
    await transport.client.connect();
    await waitForNativeView(transport.client, (view) => view.connectionStatus === "connected");
    const closed = transport.waitForClose();
    transport.client.disconnect();
    await closed;
    expect(transport.client.getSnapshot()).toEqual({
      connectionStatus: "disconnected",
      observation: null,
      isActionPending: false,
      errorMessage: null,
      binding: null,
    });
    transport.client.openReact();
    await transport.client.connect();
    await waitForNativeView(transport.client, (view) => view.connectionStatus === "connected");
    expect(transport.configurationRequests.length).toBe(2);
    expect(transport.requests.map((request) => request.command)).toEqual(["connect", "connect"]);
    expect(transport.requests.map((request) => request.id)).toEqual(["connect_1", "connect_2"]);
  } finally {
    await transport.dispose();
  }
});

test("malformed native observations release the real transport rather than expose an available inspector", async () => {
  const transport = createTransportHarness();
  try {
    await transport.client.connect();
    await waitForNativeView(transport.client, (view) => view.connectionStatus === "connected");
    const closed = transport.waitForClose();
    transport.send({ type: "state", revision: 2, state: { isReactAvailable: true } });
    const failed = await waitForNativeView(transport.client, (view) => view.errorMessage !== null);
    await closed;
    expect(failed.connectionStatus).toBe("disconnected");
    expect(failed.observation).toBeNull();
    expect(failed.errorMessage).toBe("Received an invalid native browser control message.");
  } finally {
    await transport.dispose();
  }
});

test("a native session loss stays truthful across explicit controller reconnects", async () => {
  const transport = createTransportHarness();
  try {
    await transport.client.connect();
    await waitForNativeView(transport.client, (view) => view.connectionStatus === "connected");
    transport.client.openReact();
    const open = await transport.waitForRequest(1);
    transport.acknowledge(open, 2, { isNativeSessionLost: true, isReactAvailable: false });
    await waitForNativeView(transport.client, (view) => view.observation?.isNativeSessionLost === true);
    const closed = transport.waitForClose();
    transport.client.disconnect();
    await closed;
    await transport.client.connect();
    const reconnected = await waitForNativeView(transport.client, (view) => view.connectionStatus === "connected");
    expect(reconnected.observation?.isReactAvailable).toBe(false);
    expect(reconnected.observation?.isNativeSessionLost).toBe(true);
    expect(reconnected.observation?.message).toBe(
      "The native React session was lost. Inspection recovery remains unverified.",
    );
    transport.client.openReact();
    expect(transport.requests.map((request) => request.command)).toEqual(["connect", "open-react", "connect"]);
  } finally {
    await transport.dispose();
  }
});

test("an observed session loss survives client disposal and replacement for the owning App lifetime", async () => {
  const first = createTransportHarness();
  let hasNativeSessionLoss: boolean = false;
  try {
    await first.client.connect();
    await waitForNativeView(first.client, (view) => view.connectionStatus === "connected");
    first.send({
      type: "state",
      revision: 2,
      state: {
        ...first.client.getSnapshot().observation,
        isReactAvailable: false,
        isNativeSessionLost: true,
      },
    });
    const lost = await waitForNativeView(first.client, (view) => view.observation?.isNativeSessionLost === true);
    hasNativeSessionLoss = lost.observation?.isNativeSessionLost === true;
    const closed = first.waitForClose();
    first.client.dispose();
    await closed;
  } finally {
    await first.dispose();
  }
  const replacement = createTransportHarness(hasNativeSessionLoss);
  try {
    await replacement.client.connect();
    const connected = await waitForNativeView(replacement.client, (view) => view.connectionStatus === "connected");
    expect(connected.observation?.isNativeSessionLost).toBe(true);
    expect(connected.observation?.isReactAvailable).toBe(false);
    replacement.client.openReact();
    expect(replacement.requests.map((request) => request.command)).toEqual(["connect"]);
  } finally {
    await replacement.dispose();
  }
});
