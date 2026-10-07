import type { ReduxDevtoolsDispose, ReduxDevtoolsListener } from "./types";
import { REDUX_MONITOR_PATH } from "./constants";
import { createReduxDevtoolsSchemas } from "./createReduxDevtoolsSchemas";
import type {
  IConnectedReduxDevtoolsProducer,
  IReduxDevtoolsRegistry,
  IReduxDevtoolsSession,
  ProducerMessage,
} from "./types";

export function createReduxDevtoolsSession(
  hostWindow: Window,
  registry: IReduxDevtoolsRegistry,
): IReduxDevtoolsSession {
  const listeners = new Set<ReduxDevtoolsListener>();
  const connected = new Map<string, IConnectedReduxDevtoolsProducer>();
  const errors = new Map<string, string>();
  const schemas = createReduxDevtoolsSchemas();
  let monitorWindow: Window | undefined;
  let port: MessagePort | undefined;
  let sessionId: string | undefined;
  let closeWatcher: number | undefined;
  let unsubscribeRegistry: ReduxDevtoolsDispose | undefined;
  let isStarted = false;
  let popupError: string | undefined;
  const emit = (): void => {
    listeners.forEach((listener) => listener());
  };
  const readError = (error: unknown): string => (error instanceof Error ? error.message : String(error));
  const send = (message: ProducerMessage): void => {
    if (message.type === "ERROR") errors.set(message.id, message.message);
    else errors.delete(message.id ?? "");
    port?.postMessage(message);
    emit();
  };
  const removeProducer = (id: string): void => {
    const current = connected.get(id);
    if (current === undefined) return;
    connected.delete(id);
    try {
      current.unsubscribe();
    } catch (error) {
      errors.set(id, readError(error));
    }
    send({ type: "DISCONNECTED", id });
  };
  const disconnect = (): void => {
    isStarted = false;
    [...connected.keys()].forEach(removeProducer);
    if (port !== undefined) {
      port.onmessage = null;
      port.close();
      port = undefined;
    }
    emit();
  };
  const synchronize = (): void => {
    const registrations = registry.read();
    const present = new Set(registrations.map((registration) => registration.connectionId));
    [...connected.keys()].filter((id) => !present.has(id)).forEach(removeProducer);
    [...errors.keys()].filter((id) => !present.has(id)).forEach((id) => errors.delete(id));
    for (const registration of registrations) {
      if (connected.has(registration.connectionId)) continue;
      try {
        const producer = registration.createProducer();
        if (!isStarted) {
          errors.delete(registration.connectionId);
          continue;
        }
        const unsubscribe = producer.subscribe(send);
        connected.set(registration.connectionId, { registration, producer, unsubscribe });
      } catch (error) {
        send({ type: "ERROR", id: registration.connectionId, message: `${registration.name}: ${readError(error)}` });
      }
    }
    if (registrations.length === 0) close();
    emit();
  };
  const handlePortMessage = (event: MessageEvent<unknown>): void => {
    const parsed = schemas.monitorMessage.safeParse(event.data);
    if (!parsed.success) return;
    const message = parsed.data;
    if (message.type === "STOP") {
      disconnect();
      return;
    }
    if (message.type === "START") {
      if (isStarted) return;
      isStarted = true;
      synchronize();
      return;
    }
    if (!isStarted) return;
    const targets = [...connected.values()].filter(
      (entry) =>
        entry.registration.connectionId === message.instanceId || (message.isToAll && entry.producer.kind === "redux"),
    );
    for (const entry of targets) {
      try {
        entry.producer.receive(message);
      } catch (error) {
        send({
          type: "ERROR",
          id: entry.registration.connectionId,
          message: `${entry.registration.name}: ${readError(error)}`,
        });
      }
    }
  };
  const receiveHello = (event: MessageEvent<unknown>): void => {
    const hello = schemas.hello.safeParse(event.data);
    if (
      monitorWindow === undefined ||
      monitorWindow.closed ||
      event.source !== monitorWindow ||
      event.origin !== hostWindow.location.origin ||
      !hello.success ||
      hello.data.sessionId !== sessionId
    )
      return;
    disconnect();
    const channel = new MessageChannel();
    port = channel.port1;
    port.onmessage = handlePortMessage;
    port.start();
    monitorWindow.postMessage({ type: "DEVHOST_REDUX_CHANNEL", sessionId }, hostWindow.location.origin, [
      channel.port2,
    ]);
    emit();
  };
  function close(): void {
    disconnect();
    monitorWindow?.close();
    monitorWindow = undefined;
    sessionId = undefined;
    if (closeWatcher !== undefined) hostWindow.clearInterval(closeWatcher);
    closeWatcher = undefined;
    emit();
  }
  return {
    isOpen: () => monitorWindow !== undefined && !monitorWindow.closed,
    readTitle: () => {
      const setupError = [...errors.values()][0] ?? popupError;
      if (setupError !== undefined) return `Redux DevTools unavailable: ${setupError}`;
      if (monitorWindow === undefined || monitorWindow.closed) return "Open Redux DevTools for registered host stores";
      return isStarted && connected.size > 0
        ? `Close Redux DevTools: connected to ${connected.size} registered host stores`
        : "Close Redux DevTools: window open, waiting for host connection";
    },
    open: () => {
      if (listeners.size === 0 || registry.read().length === 0) return;
      if (monitorWindow !== undefined && !monitorWindow.closed) {
        monitorWindow.focus();
        return;
      }
      close();
      popupError = undefined;
      sessionId = hostWindow.crypto.randomUUID();
      const url = new URL(REDUX_MONITOR_PATH, hostWindow.location.href);
      url.hash = sessionId;
      monitorWindow = hostWindow.open(url.href, "_blank", "popup,width=1000,height=760") ?? undefined;
      if (monitorWindow === undefined) {
        popupError = "Allow popups for this project and try again.";
        emit();
        return;
      }
      closeWatcher = hostWindow.setInterval(() => {
        if (monitorWindow?.closed) close();
      }, 100);
      emit();
    },
    close,
    subscribe: (listener) => {
      listeners.add(listener);
      if (listeners.size === 1) {
        hostWindow.addEventListener("message", receiveHello);
        hostWindow.addEventListener("pagehide", close);
        unsubscribeRegistry = registry.subscribe(synchronize);
        synchronize();
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size !== 0) return;
        unsubscribeRegistry?.();
        unsubscribeRegistry = undefined;
        hostWindow.removeEventListener("message", receiveHello);
        hostWindow.removeEventListener("pagehide", close);
        close();
      };
    },
  };
}
