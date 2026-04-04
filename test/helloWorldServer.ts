import indexHtml from "./index.html";

const recordingFile = Bun.file(new URL("./public/recording.json", import.meta.url));
const bindHost: string = process.env.DEVHOST_BIND_HOST ?? "127.0.0.1";
const host: string = process.env.DEVHOST_HOST ?? "hello.xcv.lol";
const portText: string = process.env.PORT ?? "3200";
const port: number = Number.parseInt(portText, 10);

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
  fetch(request: Request): Response {
    const requestUrl = new URL(request.url);

    if (requestUrl.pathname === "/recording.json") {
      return new Response(recordingFile, {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
      });
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`helloWorldServer listening on http://${bindHost}:${server.port} for ${host}`);
