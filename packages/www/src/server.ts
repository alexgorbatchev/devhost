import path from "node:path";
import { fileURLToPath } from "node:url";

import indexHtml from "../index.html";

import { createMarketingRecordingResponse } from "./createMarketingRecordingResponse";

const bindHost: string = process.env.DEVHOST_BIND_HOST ?? "127.0.0.1";
const host: string = process.env.DEVHOST_HOST ?? "devhost.localhost";
const isDevelopmentMode: boolean = process.env.NODE_ENV !== "production";
const portText: string = process.env.PORT ?? "3200";
const port: number = Number.parseInt(portText, 10);
const publicRootPath: string = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error(`PORT must be a valid TCP port, received: ${portText}`);
}

const server = Bun.serve({
  hostname: bindHost,
  port,
  development: isDevelopmentMode
    ? {
        hmr: false,
      }
    : false,
  routes: {
    "/": indexHtml,
  },
  async fetch(request: Request): Promise<Response> {
    const requestUrl = new URL(request.url);
    const recordingResponse = await createMarketingRecordingResponse(requestUrl.pathname, publicRootPath);

    if (recordingResponse !== null) {
      return recordingResponse;
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`Listening on http://${bindHost}:${server.port} for ${host}`);
