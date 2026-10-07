import assert from "node:assert/strict";
import type { Server } from "bun";

export function serveGuideService(): Server<undefined> {
  const port = Number(process.env.PORT);
  assert(Number.isInteger(port) && port > 0, "PORT is required");
  const server = Bun.serve({
    port,
    hostname: process.env.DEVHOST_BIND_HOST ?? "127.0.0.1",
    fetch: async (request): Promise<Response> => {
      const pathname = new URL(request.url).pathname;
      if (pathname === "/__shutdown" && request.method === "POST" && process.env.DEVHOST_DEMO_DAEMON_PID) {
        setTimeout(() => {
          server.stop(true);
        }, 50);
        return Response.json({ stopped: true });
      }
      if (process.env.SHOW_BIND_INPUTS === "1") {
        return Response.json({
          service: process.env.DEVHOST_SERVICE_NAME,
          PORT: process.env.PORT,
          DEVHOST_BIND_HOST: process.env.DEVHOST_BIND_HOST,
          DEVHOST_HOST: process.env.DEVHOST_HOST,
          DEVHOST_PORT_WEB: process.env.DEVHOST_PORT_WEB,
          message: process.env.DEMO_MESSAGE,
        });
      }
      const data = {
        service: process.env.DEVHOST_SERVICE_NAME,
        message: process.env.DEMO_MESSAGE ?? "Hello from devhost",
      };
      const upstream = process.env.API_URL;
      if (upstream) {
        const response = await fetch(upstream, { signal: AbortSignal.timeout(2_000) });
        assert(response.ok, "Referenced API is unavailable");
        return Response.json({ ...data, upstream, api: await response.json() });
      }
      return Response.json(data);
    },
  });
  console.log(`Listening on ${server.hostname}:${server.port}`);
  return server;
}

if (import.meta.main) {
  const server = serveGuideService();
  if (process.env.DEVHOST_DEMO_DAEMON_PID) await Bun.write(process.env.DEVHOST_DEMO_DAEMON_PID, String(process.pid));
  const stop = (): void => {
    server.stop(true);
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}
