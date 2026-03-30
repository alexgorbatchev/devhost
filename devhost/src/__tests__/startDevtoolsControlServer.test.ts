import { afterEach, describe, expect, test } from "bun:test";

import { HEALTH_API_PATH } from "../devtools/constants";
import { startDevtoolsControlServer } from "../startDevtoolsControlServer";

const stopFunctions: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(
    stopFunctions.splice(0).map(async (stop): Promise<void> => {
      await stop();
    }),
  );
});

describe("startDevtoolsControlServer", () => {
  test("serves the managed service health payload", async () => {
    const controlServer = await startDevtoolsControlServer({
      getHealthResponse: async () => {
        return {
          services: [
            {
              name: "api",
              status: true,
            },
          ],
        };
      },
    });

    stopFunctions.push(controlServer.stop);

    const response: Response = await fetch(`http://127.0.0.1:${controlServer.port}${HEALTH_API_PATH}`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      services: [
        {
          name: "api",
          status: true,
        },
      ],
    });
  });
});
