import { TERMINAL_SESSION_START_PATH } from "../../shared/constants";
import type { FetchFunction } from "../../shared/pristineFetch";
import { isListTerminalSessionsResponse } from "./isListTerminalSessionsResponse";
import type { ActiveTerminalSessionSnapshot, TerminalSessionPresence } from "./types";

/**
 * Asks devhost whether a terminal session still exists. A browser does not say why a WebSocket failed to connect,
 * so a page that lost its terminal connection cannot tell an ended session from an unreachable devhost by the
 * socket alone. The answer is `unknown` while devhost does not return its session list.
 */
export async function readTerminalSessionPresence(
  fetch: FetchFunction,
  sessionId: string,
): Promise<TerminalSessionPresence> {
  try {
    const response: Response = await fetch(TERMINAL_SESSION_START_PATH, { method: "GET" });

    if (!response.ok) {
      return "unknown";
    }

    const responseBody: unknown = await response.json();

    if (!isListTerminalSessionsResponse(responseBody)) {
      return "unknown";
    }

    const isListed: boolean = responseBody.sessions.some((session: ActiveTerminalSessionSnapshot): boolean => {
      return session.sessionId === sessionId;
    });

    return isListed ? "running" : "ended";
  } catch {
    return "unknown";
  }
}
