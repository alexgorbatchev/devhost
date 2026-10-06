import { z } from "zod";
import { parseNativeBrowserUpdate } from "./parseNativeBrowserUpdate";
import { createNativeBrowserView } from "./createNativeBrowserView";
import type {
  INativeBrowserBinding,
  INativeBrowserClient,
  INativeBrowserClientOptions,
  INativeBrowserView,
} from "./types";

const configurationSchema = z.object({
  nativeBrowserConfigured: z.boolean(),
  nativeBrowserInstanceId: z.string().regex(/^[a-f0-9]{32}$/),
  externalToolbarsEnabled: z.boolean(),
});
const connectionTimeoutMilliseconds: number = 10_000;
const actionTimeoutMilliseconds: number = 6_000;
const nativeBrowserProtocol: string = "devhost-native-browser.v1";

export function createNativeBrowserClient(options: INativeBrowserClientOptions): INativeBrowserClient {
  let snapshot: INativeBrowserView = createNativeBrowserView();
  const listeners = new Set<() => void>();
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  let socket: WebSocket | null = null;
  let removeSocketListeners: (() => void) | null = null;
  let configurationAbort: AbortController | null = null;
  let configurationTimeout: ReturnType<typeof setTimeout> | null = null;
  let generation: number = 0;
  let sequence: number = 0;
  let revision: number = 0;
  let hasSessionLoss: boolean = options.hasNativeSessionLoss;
  let isDisposed: boolean = false;

  const publish = (value: INativeBrowserView): void => {
    snapshot = value;
    for (const listener of listeners) listener();
  };
  const release = (): void => {
    generation++;
    configurationAbort?.abort();
    configurationAbort = null;
    if (configurationTimeout !== null) clearTimeout(configurationTimeout);
    configurationTimeout = null;
    removeSocketListeners?.();
    removeSocketListeners = null;
    const currentSocket = socket;
    socket = null;
    currentSocket?.close();
    for (const timer of pending.values()) clearTimeout(timer);
    pending.clear();
  };
  const fail = (message: string): void => {
    release();
    publish({ ...createNativeBrowserView(), errorMessage: message });
  };
  const disconnect = (): void => {
    release();
    publish(createNativeBrowserView());
  };
  const trackRequest = (id: string, milliseconds: number): void => {
    pending.set(
      id,
      setTimeout(() => fail("Native browser control did not respond. The connection was released."), milliseconds),
    );
  };
  const consume = (event: MessageEvent, expectedGeneration: number): void => {
    if (expectedGeneration !== generation || isDisposed) return;
    if (typeof event.data !== "string" || event.data.length > 16 * 1024) {
      fail("Received an invalid native browser control message.");
      return;
    }
    let value: unknown;
    try {
      value = JSON.parse(event.data);
    } catch {
      fail("Received an invalid native browser control message.");
      return;
    }
    const update = parseNativeBrowserUpdate(value);
    if (update === null) {
      fail("Received an invalid native browser control message.");
      return;
    }
    if (update.type === "error") {
      fail(update.error);
      return;
    }
    if (update.revision <= revision) return;
    if (update.id !== undefined && !pending.has(update.id)) return;
    revision = update.revision;
    if (update.id !== undefined) {
      clearTimeout(pending.get(update.id));
      pending.delete(update.id);
    }
    hasSessionLoss ||= update.state.isNativeSessionLost;
    const observation = hasSessionLoss
      ? {
          ...update.state,
          isReactAvailable: false,
          isNativeSessionLost: true,
          message: "The native React session was lost. Inspection recovery remains unverified.",
        }
      : update.state;
    publish({
      ...snapshot,
      connectionStatus: observation.isConnected ? "connected" : "disconnected",
      observation,
      isActionPending: pending.size > 0,
      errorMessage: update.error ?? null,
    });
  };

  const connect = async (): Promise<void> => {
    if (isDisposed) return;
    disconnect();
    const expectedGeneration: number = generation;
    revision = 0;
    configurationAbort = new AbortController();
    publish({ ...snapshot, connectionStatus: "connecting" });
    configurationTimeout = setTimeout(
      () => fail("Devhost configuration did not respond. The connection was released."),
      connectionTimeoutMilliseconds,
    );
    try {
      const href: string = options.getHref();
      const pageUrl = new URL(href);
      const response = await options.fetch(new URL("/__devhost__/config.json", pageUrl), {
        cache: "no-store",
        signal: configurationAbort.signal,
      });
      if (expectedGeneration !== generation || isDisposed) return;
      if (!response.ok) {
        fail("Devhost configuration is unavailable. Check that this project is running.");
        return;
      }
      const rawConfiguration: unknown = await response.json();
      if (expectedGeneration !== generation || isDisposed) return;
      const configuration = configurationSchema.safeParse(rawConfiguration);
      if (
        !configuration.success ||
        !configuration.data.nativeBrowserConfigured ||
        !configuration.data.externalToolbarsEnabled
      ) {
        fail("Native browser control is not configured or external devtools are disabled.");
        return;
      }
      if (configurationTimeout !== null) clearTimeout(configurationTimeout);
      configurationTimeout = null;
      const binding: INativeBrowserBinding = {
        instanceId: configuration.data.nativeBrowserInstanceId,
        documentId: options.documentId,
        href,
      };
      publish({ ...snapshot, binding });
      const websocketUrl = new URL("/__devhost__/ws/native-browser", pageUrl);
      websocketUrl.protocol = pageUrl.protocol === "https:" ? "wss:" : "ws:";
      const currentSocket = options.createSocket(websocketUrl, nativeBrowserProtocol);
      socket = currentSocket;
      const id: string = `connect_${++sequence}`;
      trackRequest(id, connectionTimeoutMilliseconds);
      const onOpen = (): void => {
        if (expectedGeneration === generation) currentSocket.send(JSON.stringify({ id, command: "connect", binding }));
      };
      const onMessage = (event: MessageEvent): void => consume(event, expectedGeneration);
      const onClose = (): void => {
        if (expectedGeneration === generation)
          fail("Native browser control disconnected. Reconnect explicitly when the project and browser are available.");
      };
      const onError = (): void => {
        if (expectedGeneration === generation)
          fail("Cannot connect to native browser control. Check this project's origin and browser setup.");
      };
      currentSocket.addEventListener("open", onOpen);
      currentSocket.addEventListener("message", onMessage);
      currentSocket.addEventListener("close", onClose);
      currentSocket.addEventListener("error", onError);
      removeSocketListeners = (): void => {
        currentSocket.removeEventListener("open", onOpen);
        currentSocket.removeEventListener("message", onMessage);
        currentSocket.removeEventListener("close", onClose);
        currentSocket.removeEventListener("error", onError);
      };
    } catch (error) {
      if (expectedGeneration === generation && !isDisposed) {
        fail(error instanceof Error ? error.message : "Native browser configuration failed.");
      }
    }
  };

  return {
    connect,
    disconnect,
    openReact: (): void => {
      if (
        snapshot.connectionStatus !== "connected" ||
        snapshot.isActionPending ||
        snapshot.observation?.isReactAvailable !== true ||
        snapshot.binding === null ||
        socket === null ||
        socket.readyState !== socket.OPEN
      )
        return;
      const id: string = `open_${++sequence}`;
      trackRequest(id, actionTimeoutMilliseconds);
      publish({ ...snapshot, isActionPending: true, errorMessage: null });
      socket.send(JSON.stringify({ id, command: "open-react", binding: snapshot.binding }));
    },
    getSnapshot: (): INativeBrowserView => snapshot,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return (): void => {
        listeners.delete(listener);
      };
    },
    dispose: (): void => {
      isDisposed = true;
      release();
      listeners.clear();
    },
  };
}
