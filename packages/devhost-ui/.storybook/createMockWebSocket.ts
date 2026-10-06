type MockWebSocketUrl = ConstructorParameters<typeof WebSocket>[0];
type MockWebSocketProtocols = ConstructorParameters<typeof WebSocket>[1];
type MockWebSocketSendData = Parameters<WebSocket["send"]>[0];

/** One client connection, as the mocked devhost server sees it. */
export interface IMockWebSocketConnection {
  /** Delivers a JSON message to the client. Messages sent after the client closed are dropped. */
  send: (message: unknown) => void;
  url: URL;
}

export type MockWebSocketConnectHandler = (connection: IMockWebSocketConnection) => void;

export type MockWebSocketConstructor = new (url: MockWebSocketUrl, protocols?: MockWebSocketProtocols) => EventTarget;

/**
 * Creates a `WebSocket` replacement for stories. Each socket opens in a microtask, after the client has attached
 * its listeners, and then hands the connection to `onConnect`, which plays the server.
 */
export function createMockWebSocket(onConnect: MockWebSocketConnectHandler): MockWebSocketConstructor {
  return class MockWebSocket extends EventTarget {
    static readonly CONNECTING: number = 0;
    static readonly OPEN: number = 1;
    static readonly CLOSING: number = 2;
    static readonly CLOSED: number = 3;

    readonly url: string;
    binaryType: BinaryType = "blob";
    bufferedAmount: number = 0;
    extensions: string = "";
    protocol: string = "";
    readyState: number = MockWebSocket.CONNECTING;

    constructor(url: MockWebSocketUrl, _protocols?: MockWebSocketProtocols) {
      super();

      this.url = String(url);

      queueMicrotask((): void => {
        this.openConnection();
      });
    }

    close(code: number = 1000, reason: string = ""): void {
      if (this.readyState === MockWebSocket.CLOSING || this.readyState === MockWebSocket.CLOSED) {
        return;
      }

      this.readyState = MockWebSocket.CLOSING;

      queueMicrotask((): void => {
        this.readyState = MockWebSocket.CLOSED;
        this.dispatchEvent(new CloseEvent("close", { code, reason }));
      });
    }

    send(_data: MockWebSocketSendData): void {}

    private deliverMessage(message: unknown): void {
      if (this.readyState !== MockWebSocket.OPEN) {
        return;
      }

      this.dispatchEvent(new MessageEvent<string>("message", { data: JSON.stringify(message) }));
    }

    private openConnection(): void {
      if (this.readyState !== MockWebSocket.CONNECTING) {
        return;
      }

      this.readyState = MockWebSocket.OPEN;
      this.dispatchEvent(new Event("open"));
      onConnect({
        send: (message: unknown): void => {
          this.deliverMessage(message);
        },
        url: new URL(this.url, window.location.href),
      });
    }
  };
}
