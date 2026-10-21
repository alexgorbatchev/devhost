import type { IResourceUsage } from "../src/devtools/features/resourceUsage";
import {
  DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME,
  HEALTH_WEBSOCKET_PATH,
  LOGS_WEBSOCKET_PATH,
  RESOURCES_WEBSOCKET_PATH,
} from "../src/devtools/shared/constants";
import type { IInjectedDevtoolsConfig } from "../src/devtools/shared/readInjectedDevtoolsConfig";
import type {
  HealthResponse,
  ServiceHealth,
  ServiceLogEntry,
  ServiceLogSnapshotMessage,
} from "../src/devtools/shared/types";
import { createMockWebSocket, type IMockWebSocketConnection } from "../test-support/createMockWebSocket";

/** The devhost control plane a story runs against: the injected configuration and every snapshot the server sends. */
export interface IDevhostStoryStack {
  config: IInjectedDevtoolsConfig;
  logEntries: ServiceLogEntry[];
  /** Sent on the resource usage stream; `null` sends nothing. */
  resourceUsage: IResourceUsage | null;
  services: ServiceHealth[];
}

export interface IDevhostStackMock {
  uninstall: () => void;
}

/** Installs the injected configuration and native control-stream snapshots from `stack`. */
export function installDevhostStackMock(stack: IDevhostStoryStack): IDevhostStackMock {
  const originalConfig: unknown = Reflect.get(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME);
  const originalWebSocket: unknown = Reflect.get(globalThis, "WebSocket");
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
    }
  };

  Reflect.set(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME, stack.config);
  Reflect.set(globalThis, "WebSocket", createMockWebSocket(sendSnapshot));
  return {
    uninstall: (): void => {
      Reflect.set(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME, originalConfig);
      Reflect.set(globalThis, "WebSocket", originalWebSocket);
    },
  };
}
