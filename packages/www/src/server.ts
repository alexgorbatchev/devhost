import indexHtml from "../index.html";

const bindHost: string = process.env.DEVHOST_BIND_HOST ?? "127.0.0.1";
const host: string = process.env.DEVHOST_HOST ?? "devhost.localhost";
const portText: string = process.env.PORT ?? "3200";
const port: number = Number.parseInt(portText, 10);
const marketingRecordingPaths: Record<string, URL> = {
  "/recordings/marketing/annotation.json": new URL("../public/recordings/marketing/annotation.json", import.meta.url),
  "/recordings/marketing/overlay.json": new URL("../public/recordings/marketing/overlay.json", import.meta.url),
  "/recordings/marketing/routing-health.json": new URL(
    "../public/recordings/marketing/routing-health.json",
    import.meta.url,
  ),
  "/recordings/marketing/sessions.json": new URL("../public/recordings/marketing/sessions.json", import.meta.url),
  "/recordings/marketing/source-jumps.json": new URL(
    "../public/recordings/marketing/source-jumps.json",
    import.meta.url,
  ),
};

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error(`PORT must be a valid TCP port, received: ${portText}`);
}

const server = Bun.serve({
  hostname: bindHost,
  port,
  development: {
    hmr: false,
  },
  routes: {
    "/": indexHtml,
  },
  async fetch(request: Request): Promise<Response> {
    const requestUrl = new URL(request.url);
    const recordingPath: URL | undefined = marketingRecordingPaths[requestUrl.pathname];

    if (recordingPath !== undefined) {
      const recordingFile = Bun.file(recordingPath);

      if (!(await recordingFile.exists())) {
        return new Response("Not Found", { status: 404 });
      }

      return new Response(recordingFile, {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
      });
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`Listening on http://${bindHost}:${server.port} for ${host}`);
