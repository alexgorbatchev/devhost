import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildDevtoolsScript } from "@alexgorbatchev/devhost/src/devtools-server/buildDevtoolsScript";

import indexHtml from "../index.html";
import marketingCaptureHtml from "../marketing-capture.html";

import { createMarketingRecordingResponse } from "./createMarketingRecordingResponse";
import {
  createCaptureControlPlane,
  type ICaptureControlWebSocketData,
} from "./marketingCapture/createCaptureControlPlane";

const captureDevtoolsScriptPath: string = "/__capture__/devtools.js";
let cachedCaptureDevtoolsScriptPromise: Promise<string> | null = null;
const captureControlPlane = createCaptureControlPlane();

const bindHost: string = process.env.DEVHOST_BIND_HOST ?? "127.0.0.1";
const host: string = process.env.DEVHOST_HOST ?? "devhost.localhost";
const isDevelopmentMode: boolean = process.env.NODE_ENV !== "production";
const portText: string = process.env.PORT ?? "3200";
const port: number = Number.parseInt(portText, 10);
const publicRootPath: string = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error(`PORT must be a valid TCP port, received: ${portText}`);
}

const server = Bun.serve<ICaptureControlWebSocketData>({
  hostname: bindHost,
  port,
  development: isDevelopmentMode
    ? {
        hmr: false,
      }
    : false,
  routes: {
    "/__capture__": marketingCaptureHtml,
    "/": indexHtml,
  },
  async fetch(request: Request, bunServer: Bun.Server<ICaptureControlWebSocketData>): Promise<Response | undefined> {
    const requestUrl = new URL(request.url);
    const websocketUpgradeData = captureControlPlane.readWebSocketUpgradeData(request);

    if (websocketUpgradeData !== undefined) {
      if (websocketUpgradeData === null) {
        return new Response("Forbidden", { status: 403 });
      }

      if (bunServer.upgrade(request, { data: websocketUpgradeData })) {
        return;
      }

      return new Response("WebSocket upgrade failed.", { status: 500 });
    }

    const captureControlResponse = await captureControlPlane.createHttpResponse(request);

    if (captureControlResponse !== null) {
      return captureControlResponse;
    }

    const captureDevtoolsScriptResponse = await createCaptureDevtoolsScriptResponse(requestUrl.pathname);

    if (captureDevtoolsScriptResponse !== null) {
      return captureDevtoolsScriptResponse;
    }

    const recordingResponse = await createMarketingRecordingResponse(requestUrl.pathname, publicRootPath);

    if (recordingResponse !== null) {
      return recordingResponse;
    }

    return new Response("Not Found", { status: 404 });
  },
  websocket: {
    close(websocket) {
      captureControlPlane.handleWebSocketClose(websocket);
    },
    message(websocket, message) {
      captureControlPlane.handleWebSocketMessage(websocket, message);
    },
    open(websocket) {
      captureControlPlane.handleWebSocketOpen(websocket);
    },
  },
});

console.log(`Listening on http://${bindHost}:${server.port} for ${host}`);

async function createCaptureDevtoolsScriptResponse(requestPathname: string): Promise<Response | null> {
  if (requestPathname !== captureDevtoolsScriptPath) {
    return null;
  }

  if (cachedCaptureDevtoolsScriptPromise === null) {
    cachedCaptureDevtoolsScriptPromise = buildDevtoolsScript();
  }

  try {
    const scriptText: string = await cachedCaptureDevtoolsScriptPromise;

    return new Response(scriptText, {
      headers: {
        "cache-control": "no-store",
        "content-type": "text/javascript; charset=utf-8",
      },
    });
  } catch (error) {
    cachedCaptureDevtoolsScriptPromise = null;
    throw error;
  }
}
