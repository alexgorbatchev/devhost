import { describe, expect, test } from "bun:test";

import type { FetchFunction } from "../../../shared/pristineFetch";
import { readTerminalSessionPresence } from "../readTerminalSessionPresence";
import type { ActiveTerminalSessionSnapshot } from "../types";

const EDITOR_SNAPSHOT: ActiveTerminalSessionSnapshot = {
  request: {
    componentName: "SaveButton",
    kind: "editor",
    launcher: "neovim",
    source: { columnNumber: 3, fileName: "src/SaveButton.tsx", lineNumber: 12 },
    sourceLabel: "src/SaveButton.tsx:12:3",
  },
  sessionId: "editor-session",
};

function respondWith(response: Response): FetchFunction {
  return async (): Promise<Response> => response;
}

describe("readTerminalSessionPresence", () => {
  test("asks the session list and finds a listed session running", async () => {
    const requests: string[] = [];
    const fetchSessions: FetchFunction = async (input, init): Promise<Response> => {
      requests.push(`${init?.method} ${String(input)}`);

      return Response.json({ sessions: [EDITOR_SNAPSHOT] });
    };

    expect(await readTerminalSessionPresence(fetchSessions, "editor-session")).toBe("running");
    expect(requests).toEqual(["GET /__devhost__/terminal-sessions"]);
  });

  test("finds a session the list no longer has ended", async () => {
    const fetchSessions = respondWith(Response.json({ sessions: [EDITOR_SNAPSHOT] }));

    expect(await readTerminalSessionPresence(fetchSessions, "agent-session")).toBe("ended");
  });

  test("cannot tell while devhost does not answer with a session list", async () => {
    const failingFetch: FetchFunction = async (): Promise<Response> => {
      throw new TypeError("Failed to fetch");
    };

    expect(await readTerminalSessionPresence(failingFetch, "editor-session")).toBe("unknown");
    expect(
      await readTerminalSessionPresence(respondWith(new Response("Bad gateway", { status: 502 })), "editor-session"),
    ).toBe("unknown");
    expect(await readTerminalSessionPresence(respondWith(Response.json({ sessions: [{}] })), "editor-session")).toBe(
      "unknown",
    );
    expect(await readTerminalSessionPresence(respondWith(new Response("<html>")), "editor-session")).toBe("unknown");
  });
});
