import { buildDevtoolsScript } from "./buildDevtoolsScript";
import { createConfiguredDevtoolsScript } from "./createConfiguredDevtoolsScript";
import { HEALTH_WEBSOCKET_PATH, INJECTED_SCRIPT_PATH } from "./devtools/constants";
import type { HealthResponse } from "./devtools/types";
import type { DevtoolsPosition } from "./stackTypes";

const healthTopicName: string = "devhost-health";
const healthPollIntervalInMilliseconds: number = 1_000;

interface IDevtoolsControlServer {
  port: number;
  publishHealthResponse: () => Promise<void>;
  stop: () => Promise<void>;
}

interface IStartDevtoolsControlServerOptions {
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
    options.stackName,
  );
  let isStopped: boolean = false;
  let lastPublishedMessage: string | null = null;

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request: Request, bunServer: Bun.Server): Response | undefined {
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
        const didUpgrade: boolean = bunServer.upgrade(request);

        if (didUpgrade) {
          return;
        }

        return new Response("Upgrade failed", { status: 400 });
      }

      return new Response("Not Found", { status: 404 });
    },
    websocket: {
      async open(websocket: Bun.ServerWebSocket<undefined>): Promise<void> {
        websocket.subscribe(healthTopicName);

        const healthMessage: string | null = await resolveHealthMessage();

        if (healthMessage === null) {
          return;
        }

        lastPublishedMessage = healthMessage;
        websocket.send(healthMessage);
      },
      close(websocket: Bun.ServerWebSocket<undefined>): void {
        websocket.unsubscribe(healthTopicName);
      },
    },
  });
  const pollIntervalId: ReturnType<typeof setInterval> = setInterval(() => {
    if (server.subscriberCount(healthTopicName) === 0) {
      return;
    }

    void publishHealthResponse();
  }, healthPollIntervalInMilliseconds);

  return {
    port: server.port,
    publishHealthResponse,
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

  async function resolveHealthMessage(): Promise<string | null> {
    try {
      return JSON.stringify(await options.getHealthResponse());
    } catch {
      return null;
    }
  }
}
