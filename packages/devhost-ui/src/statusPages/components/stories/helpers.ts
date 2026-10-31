import { fn } from "storybook/test";
import { createMockWebSocket, type IMockWebSocketConnection } from "../../../../test-support/createMockWebSocket";
import type { AgentActivityEvent } from "../../hooks/useAgentActivity";
import type { IRecoveryClient } from "../../types";
import { fixture_state } from "./fixtures";
import "../../statusPages.css";

export function createStoryClient(): IRecoveryClient {
  return {
    readStatus: fn(async () => fixture_state),
    readWorktrees: fn(async () => fixture_state.repositories),
    probe: fn(async () => false),
    restart: fn(async () => {}),
    switchWorktree: fn(async () => {}),
    reload: fn(),
  };
}

let agentActivityConnection: IMockWebSocketConnection | null = null;

/** Replaces the page's WebSocket with a stream a story feeds through `sendAgentActivity`. */
export function installAgentActivityStream(): VoidFunction {
  const originalWebSocket = globalThis.WebSocket;
  Reflect.set(
    globalThis,
    "WebSocket",
    createMockWebSocket((connection) => {
      agentActivityConnection = connection;
    }),
  );
  return () => {
    agentActivityConnection = null;
    Reflect.set(globalThis, "WebSocket", originalWebSocket);
  };
}

export function sendAgentActivity(event: AgentActivityEvent): void {
  if (agentActivityConnection === null) throw new Error("The activity stream is not connected.");
  agentActivityConnection.send(event);
}
