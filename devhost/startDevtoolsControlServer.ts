import { buildDevtoolsScript } from "./buildDevtoolsScript";
import { INJECTED_SCRIPT_PATH, TIME_API_PATH } from "./devtools/constants";

type IDevtoolsControlServer = {
  port: number;
  stop: () => Promise<void>;
};

export async function startDevtoolsControlServer(): Promise<IDevtoolsControlServer> {
  const devtoolsScript: string = await buildDevtoolsScript();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request: Request): Response {
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
        return new Response(
          JSON.stringify(
            {
              currentTime: new Date().toISOString(),
            },
            null,
            2,
          ),
          {
            headers: {
              "cache-control": "no-store",
              "content-type": "application/json; charset=utf-8",
            },
          },
        );
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
