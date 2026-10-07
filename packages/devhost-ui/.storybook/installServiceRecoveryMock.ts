import { factory_worktreeRepository } from "../src/devtools/features/serviceStatusPanel/components/stories/fixtures";
import {
  DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME,
  HEALTH_WEBSOCKET_PATH,
  LOGS_WEBSOCKET_PATH,
} from "../src/devtools/shared/constants";
import {
  readInjectedDevtoolsConfig,
  type IInjectedDevtoolsConfig,
} from "../src/devtools/shared/readInjectedDevtoolsConfig";
import type {
  HealthResponse,
  ServiceHealth,
  ServiceLogSnapshotMessage,
  ServiceLogUpdateMessage,
  IWorktreeRepository,
} from "../src/devtools/shared/types";
import { createMockWebSocket, type IMockWebSocketConnection } from "./createMockWebSocket";

type FetchRequestInput = Parameters<typeof fetch>[0];
type FetchRequestInit = Parameters<typeof fetch>[1];
type ServiceRecoveryMessage = HealthResponse | ServiceLogUpdateMessage;

export interface IServiceRecoveryMock {
  /** The `api` service exits with code 7 after logging a fatal error. */
  crash: () => void;
  uninstall: () => void;
}

/**
 * Replaces the injected configuration, `WebSocket`, and `fetch` with a single-service stack whose `api` service
 * can crash and be restarted. The first restart fails; the next one succeeds. With `hasWorktreeFailure`, the stack
 * starts with `api` down after a failed worktree switch, and returning to the configured checkout recovers it.
 */
export function installServiceRecoveryMock(hasWorktreeFailure: boolean): IServiceRecoveryMock {
  const originalConfig: unknown = Reflect.get(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME);
  const originalWebSocket: unknown = Reflect.get(globalThis, "WebSocket");
  const originalFetch = globalThis.fetch;
  const config: IInjectedDevtoolsConfig = {
    ...readInjectedDevtoolsConfig(),
    annotationEnabled: false,
    annotationQueueEnabled: false,
    editorEnabled: false,
    externalToolbarsEnabled: false,
    minimapEnabled: false,
    terminalEnabled: false,
    statusEnabled: true,
  };
  const connections: IMockWebSocketConnection[] = [];
  let services: ServiceHealth[] = [{ managed: true, name: "api", status: true }];
  let repositories: IWorktreeRepository[] = [];
  let shouldFailRestart: boolean = true;

  if (hasWorktreeFailure) {
    services = [{ managed: true, name: "api", status: false, exitCode: 7 }];
    repositories = [
      {
        ...factory_worktreeRepository(["api"]),
        selectedPath: "/worktrees/cart",
        runningPath: "",
        error: "Service api failed to start.",
      },
    ];
  }

  const readHealth = (): HealthResponse => {
    return { services, repositories };
  };
  const publish = (path: string, message: ServiceRecoveryMessage): void => {
    for (const connection of connections) {
      if (connection.url.pathname === path) {
        connection.send(message);
      }
    }
  };

  Reflect.set(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME, config);
  Reflect.set(
    globalThis,
    "WebSocket",
    createMockWebSocket((connection: IMockWebSocketConnection): void => {
      connections.push(connection);

      if (connection.url.pathname === HEALTH_WEBSOCKET_PATH) {
        connection.send(readHealth());
      } else if (connection.url.pathname === LOGS_WEBSOCKET_PATH) {
        const logs: ServiceLogSnapshotMessage = {
          entries: [{ id: 1, serviceName: "api", stream: "stdout", line: "[api] ready" }],
          type: "snapshot",
        };

        connection.send(logs);
      }
    }),
  );
  globalThis.fetch = Object.assign(
    async (input: FetchRequestInput, init?: FetchRequestInit): Promise<Response> => {
      if (String(input).endsWith("/worktrees")) {
        if (init?.method === "POST") {
          if (init.body !== '{"repositoryId":"shop","path":"/projects/shop"}') {
            return new Response("Invalid selection", { status: 400 });
          }

          repositories = repositories.map((repository: IWorktreeRepository): IWorktreeRepository => {
            return { ...repository, selectedPath: "/projects/shop", runningPath: "/projects/shop", error: undefined };
          });
          services = [{ managed: true, name: "api", status: true }];
          publish(HEALTH_WEBSOCKET_PATH, readHealth());

          return new Response(null, { status: 204 });
        }

        return Response.json(readHealth());
      }

      if (String(input).includes("/restart-service")) {
        if (init?.body !== '{"serviceNames":["api"]}') {
          return new Response("Invalid restart request", { status: 400 });
        }

        services = [{ managed: true, name: "api", status: false, exitCode: 7, restarting: true }];
        publish(HEALTH_WEBSOCKET_PATH, readHealth());

        if (shouldFailRestart) {
          shouldFailRestart = false;
          services = [{ managed: true, name: "api", status: false, exitCode: 1 }];
          publish(HEALTH_WEBSOCKET_PATH, readHealth());

          return new Response("Service api exited before passing its health check with code 1.", { status: 500 });
        }

        services = [{ managed: true, name: "api", status: true }];
        publish(HEALTH_WEBSOCKET_PATH, readHealth());

        return new Response(null, { status: 204 });
      }

      return originalFetch(input, init);
    },
    { preconnect: originalFetch.preconnect },
  );

  return {
    crash: (): void => {
      services = [{ managed: true, name: "api", status: false, exitCode: 7 }];
      publish(LOGS_WEBSOCKET_PATH, {
        entry: { id: 2, serviceName: "api", stream: "stderr", line: "[api] fatal error" },
        type: "entry",
      });
      publish(HEALTH_WEBSOCKET_PATH, readHealth());
    },
    uninstall: (): void => {
      Reflect.set(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME, originalConfig);
      Reflect.set(globalThis, "WebSocket", originalWebSocket);
      globalThis.fetch = originalFetch;
    },
  };
}
