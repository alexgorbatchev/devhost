import type {
  IAnnotationQueueSnapshot,
  IAnnotationQueuesSnapshotMessage,
} from "../src/devtools/features/annotationQueue/types";
import type { IResourceUsage } from "../src/devtools/features/resourceUsage";
import type {
  ActiveTerminalSessionSnapshot,
  IListTerminalSessionsResponse,
  ITerminalSessionSnapshotMessage,
} from "../src/devtools/features/terminalSessions/types";
import {
  ANNOTATION_QUEUES_WEBSOCKET_PATH,
  DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME,
  HEALTH_WEBSOCKET_PATH,
  LOGS_WEBSOCKET_PATH,
  RESOURCES_WEBSOCKET_PATH,
  TERMINAL_SESSION_ID_QUERY_PARAMETER_NAME,
  TERMINAL_SESSION_START_PATH,
  TERMINAL_SESSION_WEBSOCKET_PATH,
} from "../src/devtools/shared/constants";
import type { IInjectedDevtoolsConfig } from "../src/devtools/shared/readInjectedDevtoolsConfig";
import type {
  HealthResponse,
  ServiceHealth,
  ServiceLogEntry,
  ServiceLogSnapshotMessage,
} from "../src/devtools/shared/types";
import { createMockWebSocket, type IMockWebSocketConnection } from "../test-support/createMockWebSocket";

type FetchRequestInput = Parameters<typeof fetch>[0];
type FetchRequestInit = Parameters<typeof fetch>[1];

/** The devhost control plane a story runs against: the injected configuration and every snapshot the server sends. */
export interface IDevhostStoryStack {
  annotationQueues: IAnnotationQueueSnapshot[];
  config: IInjectedDevtoolsConfig;
  /** Sent to terminal sessions that have no entry in `terminalSnapshots`; `null` sends nothing. */
  fallbackTerminalSnapshot: string | null;
  logEntries: ServiceLogEntry[];
  /** Sent on the resource usage stream; `null` sends nothing. */
  resourceUsage: IResourceUsage | null;
  services: ServiceHealth[];
  terminalSessions: ActiveTerminalSessionSnapshot[];
  terminalSnapshots: Record<string, string>;
}

export interface IDevhostStackMock {
  uninstall: () => void;
}

/** Replaces the injected configuration, `WebSocket`, and `fetch` with a server that answers from `stack`. */
export function installDevhostStackMock(stack: IDevhostStoryStack): IDevhostStackMock {
  const originalConfig: unknown = Reflect.get(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME);
  const originalWebSocket: unknown = Reflect.get(globalThis, "WebSocket");
  const originalFetch = globalThis.fetch;
  const sendSnapshot = (connection: IMockWebSocketConnection): void => {
    if (connection.url.pathname === HEALTH_WEBSOCKET_PATH) {
      const health: HealthResponse = { services: stack.services };

      connection.send(health);
    } else if (connection.url.pathname === LOGS_WEBSOCKET_PATH) {
      const logs: ServiceLogSnapshotMessage = { entries: stack.logEntries, type: "snapshot" };

      connection.send(logs);
    } else if (connection.url.pathname === RESOURCES_WEBSOCKET_PATH) {
      if (stack.resourceUsage !== null) {
        connection.send(stack.resourceUsage);
      }
    } else if (connection.url.pathname === ANNOTATION_QUEUES_WEBSOCKET_PATH) {
      const queues: IAnnotationQueuesSnapshotMessage = { queues: stack.annotationQueues, type: "snapshot" };

      connection.send(queues);
    } else if (connection.url.pathname === TERMINAL_SESSION_WEBSOCKET_PATH) {
      const sessionId: string = connection.url.searchParams.get(TERMINAL_SESSION_ID_QUERY_PARAMETER_NAME) ?? "";
      const data: string | null = stack.terminalSnapshots[sessionId] ?? stack.fallbackTerminalSnapshot;

      if (data !== null) {
        const terminal: ITerminalSessionSnapshotMessage = { data, type: "snapshot" };

        connection.send(terminal);
      }
    }
  };

  Reflect.set(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME, stack.config);
  Reflect.set(globalThis, "WebSocket", createMockWebSocket(sendSnapshot));
  globalThis.fetch = Object.assign(
    async (input: FetchRequestInput, init?: FetchRequestInit): Promise<Response> => {
      const requestUrl = new URL(input instanceof Request ? input.url : String(input), window.location.href);

      if (requestUrl.pathname === TERMINAL_SESSION_START_PATH) {
        const sessions: IListTerminalSessionsResponse = { sessions: stack.terminalSessions };

        return Response.json(sessions);
      }

      return originalFetch(input, init);
    },
    { preconnect: originalFetch.preconnect },
  );

  return {
    uninstall: (): void => {
      Reflect.set(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME, originalConfig);
      Reflect.set(globalThis, "WebSocket", originalWebSocket);
      globalThis.fetch = originalFetch;
    },
  };
}
