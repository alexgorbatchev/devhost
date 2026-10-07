import { TERMINAL_SESSION_ID_QUERY_PARAMETER_NAME, TERMINAL_SESSION_WEBSOCKET_PATH } from "../../shared/constants";
import { createDevtoolsWebSocketUrl } from "../../shared/createDevtoolsWebSocketUrl";
import { openReconnectingWebSocket } from "../../shared/openReconnectingWebSocket";
import type { FetchFunction } from "../../shared/pristineFetch";
import type { ILocationHostProtocol } from "../../shared/types";
import { parseTerminalSessionServerMessage } from "./parseTerminalSessionServerMessage";
import { readTerminalSessionPresence } from "./readTerminalSessionPresence";
import type {
  TerminalSessionClientMessage,
  TerminalSessionPresence,
  TerminalSessionServerMessage,
  TerminalSessionStatus,
} from "./types";

const sessionEndedMessage: string = "This terminal session is no longer running.";

export interface ITerminalSessionStreamOptions {
  fetch: FetchFunction;
  location: ILocationHostProtocol;
  /** A connection to the session opened: the first one, or one that replaces a lost connection. */
  onOpen: () => void;
  onOutput: (data: string) => void;
  /** Everything the session has printed that devhost still holds. It replaces what was received before. */
  onSnapshot: (data: string) => void;
  onStatusChange: (status: TerminalSessionStatus, errorMessage: string | null) => void;
  sessionId: string;
}

export interface ITerminalSessionStream {
  /** Detaches from the session for good; no handler runs after it. The session itself keeps running. */
  close: () => void;
  /** Sends `message` to the session. It is dropped while no connection is open. */
  send: (message: TerminalSessionClientMessage) => void;
}

/**
 * Attaches to a terminal session and stays attached. Devhost keeps a session and its output while no browser is
 * connected, so a lost connection is reopened and the session's snapshot arrives again. Reattaching stops when the
 * session has exited, since nothing more will arrive, and when the session is gone: devhost closes the connection
 * normally when the session ends while attached, and no longer lists a session that ended while the page was not.
 */
export function openTerminalSessionStream(options: ITerminalSessionStreamOptions): ITerminalSessionStream {
  const websocketUrl: URL = new URL(createDevtoolsWebSocketUrl(TERMINAL_SESSION_WEBSOCKET_PATH, options.location));
  let hasExited: boolean = false;
  let isAttached: boolean = false;
  let isClosed: boolean = false;

  websocketUrl.searchParams.set(TERMINAL_SESSION_ID_QUERY_PARAMETER_NAME, options.sessionId);

  const stream = openReconnectingWebSocket(websocketUrl.toString(), {
    onDisconnect: (): void => {
      isAttached = false;

      if (hasExited) {
        stream.close();
        return;
      }

      options.onStatusChange("disconnected", null);
      void stopIfSessionEnded();
    },
    // Devhost ends a session's connections when the session ends: another page closed it, or the stack stopped.
    onEnd: (): void => {
      isClosed = true;

      if (!hasExited) {
        options.onStatusChange("error", sessionEndedMessage);
      }
    },
    onMessage: (event: MessageEvent): void => {
      const message: TerminalSessionServerMessage | null = parseTerminalSessionServerMessage(event.data);

      if (message === null) {
        options.onStatusChange("error", "Received an invalid terminal message.");
        return;
      }

      if (message.type === "snapshot") {
        options.onSnapshot(message.data);
        return;
      }

      if (message.type === "output") {
        options.onOutput(message.data);
        return;
      }

      if (message.type === "exit") {
        hasExited = true;
        options.onStatusChange("exited", null);
        return;
      }

      options.onStatusChange("error", message.message);
    },
    onOpen: (): void => {
      isAttached = true;
      options.onStatusChange("running", null);
      options.onOpen();
    },
  });

  return {
    close: (): void => {
      isClosed = true;
      stream.close();
    },
    send: (message: TerminalSessionClientMessage): void => {
      stream.send(JSON.stringify(message));
    },
  };

  // A browser does not say why a WebSocket failed to connect, so the session list tells an ended session from an
  // unreachable devhost. The answer can arrive after the stream reattached, and then it no longer applies.
  async function stopIfSessionEnded(): Promise<void> {
    const presence: TerminalSessionPresence = await readTerminalSessionPresence(options.fetch, options.sessionId);

    if (presence !== "ended" || isAttached || isClosed) {
      return;
    }

    isClosed = true;
    stream.close();
    options.onStatusChange("error", sessionEndedMessage);
  }
}
