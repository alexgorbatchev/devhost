import { pristineWebSocket } from "./pristineFetch";

const normalClosureCode: number = 1_000;
const initialReconnectDelayMilliseconds: number = 1_000;
const maximumReconnectDelayMilliseconds: number = 10_000;

type StreamEventHandler = () => void;
type StreamMessageHandler = (event: MessageEvent) => void;

export interface IReconnectingWebSocketHandlers {
  /** The connection was lost. Another one is opened after a delay. */
  onDisconnect?: StreamEventHandler;
  onMessage: StreamMessageHandler;
  onOpen?: StreamEventHandler;
}

export type CloseReconnectingWebSocket = () => void;

/**
 * Opens a devtools control stream and keeps it open. A lost connection, such as devhost restarting or the machine
 * sleeping, is reopened after a delay that starts at one second, doubles with each failed attempt up to ten seconds,
 * and starts over once a connection opens. A stream the server closes normally stays closed.
 *
 * Returns the function that closes the stream for good; no handler runs after it.
 */
export function openReconnectingWebSocket(
  url: string,
  handlers: IReconnectingWebSocketHandlers,
): CloseReconnectingWebSocket {
  let websocket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectDelayMilliseconds: number = initialReconnectDelayMilliseconds;
  let isClosed: boolean = false;

  const connect = (): void => {
    const connection: WebSocket = pristineWebSocket(url);

    websocket = connection;
    connection.addEventListener("open", (): void => {
      if (isClosed) {
        return;
      }

      reconnectDelayMilliseconds = initialReconnectDelayMilliseconds;
      handlers.onOpen?.();
    });
    // A socket still delivers messages between `close()` and its close event.
    connection.addEventListener("message", (event: MessageEvent): void => {
      if (!isClosed) {
        handlers.onMessage(event);
      }
    });
    connection.addEventListener("close", (event: CloseEvent): void => {
      websocket = null;

      if (isClosed || event.code === normalClosureCode) {
        return;
      }

      handlers.onDisconnect?.();
      reconnectTimer = setTimeout((): void => {
        reconnectTimer = null;
        connect();
      }, reconnectDelayMilliseconds);
      reconnectDelayMilliseconds = Math.min(reconnectDelayMilliseconds * 2, maximumReconnectDelayMilliseconds);
    });
  };

  connect();

  return (): void => {
    isClosed = true;

    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    websocket?.close(normalClosureCode, "devtools unmounted");
  };
}
