import { afterEach, describe, expect, test } from "bun:test";

import { HEALTH_WEBSOCKET_PATH } from "../devtools/constants";
import type { HealthResponse } from "../devtools/types";
import { startDevtoolsControlServer } from "../startDevtoolsControlServer";

const stopFunctions: Array<() => Promise<void>> = [];
const websockets: WebSocket[] = [];

afterEach(async () => {
  for (const websocket of websockets.splice(0)) {
    websocket.close();
  }

  await Promise.all(
    stopFunctions.splice(0).map(async (stop): Promise<void> => {
      await stop();
    }),
  );
});

describe("startDevtoolsControlServer", () => {
  test("streams managed service health payloads over websocket", async () => {
    let healthResponse: HealthResponse = {
      services: [
        {
          name: "api",
          status: true,
        },
      ],
    };
    const controlServer = await startDevtoolsControlServer({
      devtoolsPosition: "top-left",
      getHealthResponse: async (): Promise<HealthResponse> => {
        return healthResponse;
      },
      stackName: "hello-stack",
    });

    stopFunctions.push(controlServer.stop);

    const websocket = new WebSocket(`ws://127.0.0.1:${controlServer.port}${HEALTH_WEBSOCKET_PATH}`);

    websockets.push(websocket);

    await expect(waitForWebSocketMessage(websocket)).resolves.toBe(JSON.stringify(healthResponse));

    const nextMessagePromise: Promise<string> = waitForWebSocketMessage(websocket);

    healthResponse = {
      services: [
        {
          name: "api",
          status: false,
        },
      ],
    };

    await controlServer.publishHealthResponse();

    await expect(nextMessagePromise).resolves.toBe(JSON.stringify(healthResponse));
  });
});

function waitForWebSocketMessage(websocket: WebSocket): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const handleClose = (): void => {
      cleanup();
      reject(new Error("WebSocket closed before receiving a message."));
    };
    const handleError = (): void => {
      cleanup();
      reject(new Error("WebSocket error."));
    };
    const handleMessage = (event: MessageEvent): void => {
      cleanup();

      if (typeof event.data !== "string") {
        reject(new Error("Expected a text websocket message."));
        return;
      }

      resolve(event.data);
    };

    const cleanup = (): void => {
      websocket.removeEventListener("close", handleClose);
      websocket.removeEventListener("error", handleError);
      websocket.removeEventListener("message", handleMessage);
    };

    websocket.addEventListener("close", handleClose);
    websocket.addEventListener("error", handleError);
    websocket.addEventListener("message", handleMessage);
  });
}
