import { buildDevtoolsScript } from "./buildDevtoolsScript";
import { createConfiguredDevtoolsScript } from "./createConfiguredDevtoolsScript";
import {
  HEALTH_WEBSOCKET_PATH,
  INJECTED_SCRIPT_PATH,
  LOGS_WEBSOCKET_PATH,
  maximumRetainedLogEntries,
} from "./devtools/constants";
import type {
  HealthResponse,
  ServiceLogEntry,
  ServiceLogSnapshotMessage,
  ServiceLogStream,
  ServiceLogUpdateMessage,
} from "./devtools/types";
import type { DevtoolsMinimapPosition, DevtoolsPosition } from "./stackTypes";

const healthTopicName: string = "devhost-health";
const logsTopicName: string = "devhost-logs";
const healthPollIntervalInMilliseconds: number = 1_000;

type WebSocketTopicName = typeof healthTopicName | typeof logsTopicName;

type DevtoolsWebSocketData = {
  topicName: WebSocketTopicName;
};

interface IDevtoolsControlServer {
  port: number;
  publishHealthResponse: () => Promise<void>;
  publishLogEntry: (serviceName: string, stream: ServiceLogStream, line: string) => void;
  stop: () => Promise<void>;
}

interface IStartDevtoolsControlServerOptions {
  devtoolsMinimapPosition: DevtoolsMinimapPosition;
  devtoolsPosition: DevtoolsPosition;
  getHealthResponse: () => Promise<HealthResponse>;
  stackName: string;
}

export async function startDevtoolsControlServer(
  options: IStartDevtoolsControlServerOptions,
): Promise<IDevtoolsControlServer> {
  const devtoolsScript: string = createConfiguredDevtoolsScript(
    await buildDevtoolsScript(),
    options.devtoolsPosition,
    options.devtoolsMinimapPosition,
    options.stackName,
  );
  const retainedLogEntries: ServiceLogEntry[] = [];
  let isStopped: boolean = false;
  let lastPublishedMessage: string | null = null;
  let nextLogEntryId: number = 1;

  const server = Bun.serve<DevtoolsWebSocketData>({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request: Request, bunServer: Bun.Server<DevtoolsWebSocketData>): Response | undefined {
      const requestUrl: URL = new URL(request.url);

      if (requestUrl.pathname === INJECTED_SCRIPT_PATH) {
        return new Response(devtoolsScript, {
          headers: {
            "cache-control": "no-store",
            "content-type": "application/javascript; charset=utf-8",
          },
        });
      }

      if (requestUrl.pathname === HEALTH_WEBSOCKET_PATH) {
        const didUpgrade: boolean = bunServer.upgrade(request, {
          data: {
            topicName: healthTopicName,
          },
        });

        if (didUpgrade) {
          return;
        }

        return new Response("Upgrade failed", { status: 400 });
      }

      if (requestUrl.pathname === LOGS_WEBSOCKET_PATH) {
        const didUpgrade: boolean = bunServer.upgrade(request, {
          data: {
            topicName: logsTopicName,
          },
        });

        if (didUpgrade) {
          return;
        }

        return new Response("Upgrade failed", { status: 400 });
      }

      return new Response("Not Found", { status: 404 });
    },
    websocket: {
      async open(websocket: Bun.ServerWebSocket<DevtoolsWebSocketData>): Promise<void> {
        websocket.subscribe(websocket.data.topicName);

        if (websocket.data.topicName === healthTopicName) {
          const healthMessage: string | null = await resolveHealthMessage();

          if (healthMessage === null) {
            return;
          }

          lastPublishedMessage = healthMessage;
          websocket.send(healthMessage);
          return;
        }

        websocket.send(JSON.stringify(createServiceLogSnapshotMessage(retainedLogEntries)));
      },
      close(websocket: Bun.ServerWebSocket<DevtoolsWebSocketData>): void {
        websocket.unsubscribe(websocket.data.topicName);
      },
    },
  });
  const pollIntervalId: ReturnType<typeof setInterval> = setInterval((): void => {
    if (server.subscriberCount(healthTopicName) === 0) {
      return;
    }

    void publishHealthResponse();
  }, healthPollIntervalInMilliseconds);

  return {
    port: server.port,
    publishHealthResponse,
    publishLogEntry,
    stop: async (): Promise<void> => {
      isStopped = true;
      clearInterval(pollIntervalId);
      await server.stop(true);
    },
  };

  async function publishHealthResponse(): Promise<void> {
    if (isStopped) {
      return;
    }

    const healthMessage: string | null = await resolveHealthMessage();

    if (healthMessage === null || healthMessage === lastPublishedMessage) {
      return;
    }

    lastPublishedMessage = healthMessage;

    if (server.subscriberCount(healthTopicName) > 0) {
      server.publish(healthTopicName, healthMessage);
    }
  }

  function publishLogEntry(serviceName: string, stream: ServiceLogStream, line: string): void {
    if (isStopped) {
      return;
    }

    const logEntry: ServiceLogEntry = {
      id: nextLogEntryId,
      line,
      serviceName,
      stream,
    };
    const updateMessage: string = JSON.stringify(createServiceLogUpdateMessage(logEntry));

    nextLogEntryId += 1;
    retainedLogEntries.push(logEntry);

    if (retainedLogEntries.length > maximumRetainedLogEntries) {
      retainedLogEntries.splice(0, retainedLogEntries.length - maximumRetainedLogEntries);
    }

    if (server.subscriberCount(logsTopicName) > 0) {
      server.publish(logsTopicName, updateMessage);
    }
  }

  async function resolveHealthMessage(): Promise<string | null> {
    try {
      return JSON.stringify(await options.getHealthResponse());
    } catch {
      return null;
    }
  }
}

function createServiceLogSnapshotMessage(entries: ServiceLogEntry[]): ServiceLogSnapshotMessage {
  return {
    entries,
    type: "snapshot",
  };
}

function createServiceLogUpdateMessage(entry: ServiceLogEntry): ServiceLogUpdateMessage {
  return {
    entry,
    type: "entry",
  };
}
