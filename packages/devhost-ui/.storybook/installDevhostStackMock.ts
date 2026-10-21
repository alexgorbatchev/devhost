import type { IConfigFile } from "../src/devtools/features/configEditor/types";
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
  IConfigurationStatus,
  ServiceHealth,
  ServiceLogEntry,
  ServiceLogSnapshotMessage,
} from "../src/devtools/shared/types";
import { createMockWebSocket, type IMockWebSocketConnection } from "../test-support/createMockWebSocket";
import {
  CONFIG_FILES_PATH,
  CONFIG_SCHEMA_PATH,
  CONFIG_VALIDATE_PATH,
} from "../src/devtools/features/configEditor/constants";

/** The devhost control plane a story runs against: the injected configuration and every snapshot the server sends. */
export interface IDevhostStoryStack {
  config: IInjectedDevtoolsConfig;
  /** The files the config editor lists; absent, its routes are not answered. */
  configFiles?: IConfigFile[];
  /** The reloads of each configuration source the health stream reports. */
  configuration?: IConfigurationStatus[];
  logEntries: ServiceLogEntry[];
  /** Sent on the resource usage stream; `null` sends nothing. */
  resourceUsage: IResourceUsage | null;
  services: ServiceHealth[];
}

type FetchRequestInput = Parameters<typeof fetch>[0];
type FetchRequestInit = Parameters<typeof fetch>[1];

export interface IDevhostStackMock {
  uninstall: () => void;
}

/** Installs the injected configuration and native control-stream snapshots from `stack`. */
export function installDevhostStackMock(stack: IDevhostStoryStack): IDevhostStackMock {
  const originalConfig: unknown = Reflect.get(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME);
  const originalWebSocket: unknown = Reflect.get(globalThis, "WebSocket");
  const originalFetch = globalThis.fetch;
  const sendSnapshot = (connection: IMockWebSocketConnection): void => {
    if (connection.url.pathname === HEALTH_WEBSOCKET_PATH) {
      const health: HealthResponse = { configuration: stack.configuration, services: stack.services };

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
  globalThis.fetch = Object.assign(
    async (input: FetchRequestInput, init?: FetchRequestInit): Promise<Response> => {
      const requestUrl = new URL(input instanceof Request ? input.url : String(input), window.location.href);

      if (stack.configFiles !== undefined && requestUrl.pathname === CONFIG_FILES_PATH) {
        return Response.json({ files: stack.configFiles });
      }

      if (stack.configFiles !== undefined && requestUrl.pathname === CONFIG_SCHEMA_PATH) {
        return Response.json({
          config: { tables: { "": ["caddy"] }, values: {} },
          manifest: { tables: { "": ["name", "services"] }, values: {} },
        });
      }

      if (stack.configFiles !== undefined && requestUrl.pathname === CONFIG_VALIDATE_PATH) {
        return Response.json({ issues: [] });
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
