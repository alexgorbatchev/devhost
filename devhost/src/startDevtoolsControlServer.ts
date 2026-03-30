import { buildDevtoolsScript } from "./buildDevtoolsScript";
import { HEALTH_API_PATH, INJECTED_SCRIPT_PATH, TIME_API_PATH } from "./devtools/constants";
import type { HealthResponse } from "./devtools/types";

interface IDevtoolsControlServer {
  port: number;
  stop: () => Promise<void>;
}

interface IStartDevtoolsControlServerOptions {
  getHealthResponse: () => Promise<HealthResponse>;
}

export async function startDevtoolsControlServer(
  options: IStartDevtoolsControlServerOptions,
): Promise<IDevtoolsControlServer> {
  const devtoolsScript: string = await buildDevtoolsScript();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request: Request): Promise<Response> {
      const requestUrl: URL = new URL(request.url);

      if (requestUrl.pathname === INJECTED_SCRIPT_PATH) {
        return new Response(devtoolsScript, {
          headers: {
            "cache-control": "no-store",
            "content-type": "application/javascript; charset=utf-8",
          },
        });
      }

      if (requestUrl.pathname === TIME_API_PATH) {
        return createJsonResponse({
          currentTime: new Date().toISOString(),
        });
      }

      if (requestUrl.pathname === HEALTH_API_PATH) {
        try {
          return createJsonResponse(await options.getHealthResponse());
        } catch (error: unknown) {
          const message: string = error instanceof Error ? error.message : String(error);
          return new Response(message, { status: 500 });
        }
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  return {
    port: server.port,
    stop: async (): Promise<void> => {
      await server.stop(true);
    },
  };
}

function createJsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
}
