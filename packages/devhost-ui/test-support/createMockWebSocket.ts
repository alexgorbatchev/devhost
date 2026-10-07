type MockWebSocketUrl = ConstructorParameters<typeof WebSocket>[0];
type MockWebSocketProtocols = ConstructorParameters<typeof WebSocket>[1];
type MockWebSocketSendData = Parameters<WebSocket["send"]>[0];
type MockWebSocketFrame = string | ArrayBuffer;

/** How the client ended a connection. */
export interface IMockWebSocketClosure {
  code: number;
  reason: string;
}

/** One client connection, as the mocked devhost server sees it. */
export interface IMockWebSocketConnection {
  /**
   * Ends the connection from the server side. The client receives a close event with `code`, also when it had
   * already called `close()`: a connection lost during the closing handshake ends with the abnormal code.
   */
  close: (code: number) => void;
  /** How the client closed the connection, or `null` while it has not. */
  readClientClosure: () => IMockWebSocketClosure | null;
  /** What the client has sent over the open connection, oldest first. */
  readSentFrames: () => MockWebSocketSendData[];
  /**
   * Delivers a JSON message to the client. Like a real socket, the client still receives messages between its call
   * to `close()` and the close event; messages sent after that are dropped.
   */
  send: (message: unknown) => void;
  /** Delivers one frame exactly as given: text that need not be JSON, or binary data. */
  sendFrame: (frame: MockWebSocketFrame) => void;
  url: URL;
}

export type MockWebSocketConnectHandler = (connection: IMockWebSocketConnection) => void;

/** Decides whether the server accepts a socket the client has just made. */
export type MockWebSocketAcceptHandler = () => boolean;

export type MockWebSocketConstructor = new (url: MockWebSocketUrl, protocols?: MockWebSocketProtocols) => EventTarget;

/**
 * Creates a `WebSocket` replacement for stories and unit tests. Each socket opens in a microtask, after the client
 * has attached its listeners, and then hands the connection to `onConnect`, which plays the server. A socket that
 * `acceptsConnection` turns away fails the way it does when nothing listens: an error, then an abnormal close.
 */
export function createMockWebSocket(
  onConnect: MockWebSocketConnectHandler,
  acceptsConnection: MockWebSocketAcceptHandler = (): boolean => true,
): MockWebSocketConstructor {
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
    private clientClosure: IMockWebSocketClosure | null = null;
    private readonly sentFrames: MockWebSocketSendData[] = [];

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
      this.clientClosure = { code, reason };

      queueMicrotask((): void => {
        if (this.readyState === MockWebSocket.CLOSED) {
          return;
        }

        this.readyState = MockWebSocket.CLOSED;
        this.dispatchEvent(new CloseEvent("close", { code, reason }));
      });
    }

    // Like a real socket: sending before the connection opens is an error, and a closing socket drops the frame.
    send(data: MockWebSocketSendData): void {
      if (this.readyState === MockWebSocket.CONNECTING) {
        throw new DOMException("Still in CONNECTING state.", "InvalidStateError");
      }

      if (this.readyState === MockWebSocket.OPEN) {
        this.sentFrames.push(data);
      }
    }

    private closeFromServer(code: number): void {
      if (this.readyState !== MockWebSocket.OPEN && this.readyState !== MockWebSocket.CLOSING) {
        return;
      }

      this.readyState = MockWebSocket.CLOSED;
      this.dispatchEvent(new CloseEvent("close", { code }));
    }

    private deliverFrame(frame: MockWebSocketFrame): void {
      if (this.readyState !== MockWebSocket.OPEN && this.readyState !== MockWebSocket.CLOSING) {
        return;
      }

      this.dispatchEvent(new MessageEvent<MockWebSocketFrame>("message", { data: frame }));
    }

    private openConnection(): void {
      if (this.readyState !== MockWebSocket.CONNECTING) {
        return;
      }

      if (!acceptsConnection()) {
        this.readyState = MockWebSocket.CLOSED;
        this.dispatchEvent(new Event("error"));
        this.dispatchEvent(new CloseEvent("close", { code: 1006 }));
        return;
      }

      this.readyState = MockWebSocket.OPEN;
      this.dispatchEvent(new Event("open"));
      onConnect({
        close: (code: number): void => {
          this.closeFromServer(code);
        },
        readClientClosure: (): IMockWebSocketClosure | null => this.clientClosure,
        readSentFrames: (): MockWebSocketSendData[] => [...this.sentFrames],
        send: (message: unknown): void => {
          this.deliverFrame(JSON.stringify(message));
        },
        sendFrame: (frame: MockWebSocketFrame): void => {
          this.deliverFrame(frame);
        },
        // A unit test outside a browser has no page to resolve a relative URL against.
        url: new URL(this.url, typeof window === "undefined" ? undefined : window.location.href),
      });
    }
  };
}
