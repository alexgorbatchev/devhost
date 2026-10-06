import { REMOVE_INSTANCE, UPDATE_STATE, showNotification } from "@redux-devtools/app-core";
import { createReduxDevtoolsMonitorStore } from "./createReduxDevtoolsMonitorStore";
import { isReduxDevtoolsProtocolMessage } from "./isReduxDevtoolsProtocolMessage";
import { renderReduxDevtoolsMonitor } from "./components/renderReduxDevtoolsMonitor";

export function startReduxDevtoolsMonitor(hostWindow: Window): () => void {
  const container = hostWindow.document.getElementById("redux-monitor");
  if (container === null) throw new Error("Redux DevTools monitor mount is missing.");
  let port: MessagePort | undefined;
  let isDisposed = false;
  const store = createReduxDevtoolsMonitorStore((message) => port?.postMessage(message));
  const unmount = renderReduxDevtoolsMonitor(container, store);
  const sessionId = hostWindow.location.hash.slice(1);
  const connect = (event: MessageEvent<unknown>): void => {
    if (
      isDisposed ||
      event.origin !== hostWindow.location.origin ||
      event.source !== hostWindow.opener ||
      typeof event.data !== "object" ||
      event.data === null ||
      !("type" in event.data) ||
      event.data.type !== "DEVHOST_REDUX_CHANNEL" ||
      !("sessionId" in event.data) ||
      event.data.sessionId !== sessionId
    )
      return;
    const received = event.ports[0];
    if (received === undefined) return;
    port?.close();
    port = received;
    port.onmessage = (message: MessageEvent<unknown>) => {
      if (!isReduxDevtoolsProtocolMessage(message.data)) return;
      const data = message.data;
      if (data.type === "DISCONNECTED") {
        store.dispatch({ type: REMOVE_INSTANCE, id: data.id });
      } else if (data.type === "ERROR") {
        store.dispatch(showNotification(data.message));
      } else {
        store.dispatch({ type: UPDATE_STATE, request: data, id: data.id });
      }
    };
    port.start();
    port.postMessage({ type: "START" });
  };
  const dispose = (): void => {
    if (isDisposed) return;
    isDisposed = true;
    port?.postMessage({ type: "STOP" });
    port?.close();
    port = undefined;
    hostWindow.removeEventListener("message", connect);
    hostWindow.removeEventListener("pagehide", dispose);
    unmount();
  };
  hostWindow.addEventListener("message", connect);
  hostWindow.addEventListener("pagehide", dispose);
  if (hostWindow.opener === null || sessionId === "") {
    store.dispatch(
      showNotification("Open Redux DevTools from a registered host page's devhost toolbar to connect real stores."),
    );
  } else {
    hostWindow.opener.postMessage({ type: "DEVHOST_REDUX_HELLO", sessionId }, hostWindow.location.origin);
  }
  return dispose;
}

if (typeof window !== "undefined") startReduxDevtoolsMonitor(window);
