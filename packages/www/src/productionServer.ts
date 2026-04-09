import path from "node:path";
import { fileURLToPath } from "node:url";

import { createMarketingRecordingResponse } from "./createMarketingRecordingResponse";

const bindHost: string = process.env.DEVHOST_BIND_HOST ?? "127.0.0.1";
const host: string = process.env.DEVHOST_HOST ?? "devhost.localhost";
const portText: string = process.env.PORT ?? "3200";
const port: number = Number.parseInt(portText, 10);
const serverRootPath: string = path.dirname(fileURLToPath(import.meta.url));
const publicRootPath: string = path.join(serverRootPath, "public");
const staticRootPath: string = path.join(serverRootPath, "static");
const staticIndexPath: string = path.join(staticRootPath, "index.html");

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error(`PORT must be a valid TCP port, received: ${portText}`);
}

const server = Bun.serve({
  development: false,
  hostname: bindHost,
  port,
  async fetch(request: Request): Promise<Response> {
    const requestUrl = new URL(request.url);
    const recordingResponse = await createMarketingRecordingResponse(requestUrl.pathname, publicRootPath);

    if (recordingResponse !== null) {
      return recordingResponse;
    }

    if (requestUrl.pathname === "/") {
      return await createStaticFileResponse(staticIndexPath);
    }

    const staticFilePath = resolveStaticFilePath(requestUrl.pathname);

    if (staticFilePath !== null) {
      return await createStaticFileResponse(staticFilePath);
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`Listening on http://${bindHost}:${server.port} for ${host}`);

async function createStaticFileResponse(filePath: string): Promise<Response> {
  const file = Bun.file(filePath);

  if (!(await file.exists())) {
    return new Response("Not Found", { status: 404 });
  }

  return new Response(file);
}

function resolveStaticFilePath(requestPathname: string): string | null {
  if (requestPathname === "/") {
    return null;
  }

  const relativeStaticPath: string = requestPathname.slice(1);
  const resolvedStaticPath: string = path.resolve(staticRootPath, relativeStaticPath);

  if (!resolvedStaticPath.startsWith(`${staticRootPath}${path.sep}`)) {
    return null;
  }

  return resolvedStaticPath;
}
