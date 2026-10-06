import { describe, expect, it, mock } from "bun:test";

import { restartServices } from "../restartServices";

describe("restartServices", () => {
  it("posts a service restart without credentials", async () => {
    const request = mock(async () => new Response(null, { status: 204 }));
    expect(await restartServices(["api"], request as unknown as typeof fetch)).toBeNull();
    expect(request).toHaveBeenCalledWith("/__devhost__/restart-service", {
      body: '{"serviceNames":["api"]}',
      headers: { "content-type": "application/json" },
      method: "POST",
    });
  });

  it.each([
    ["health check failed\n", "Failed to restart api: health check failed"],
    ['{"error":"process exited"}', "Failed to restart api: process exited"],
  ])("reports restart failures from %s", async (body, message) => {
    const request = mock(async () => new Response(body, { status: 500 }));
    expect(await restartServices(["api"], request as unknown as typeof fetch)).toBe(message);
  });

  it("reports a disconnected control server", async () => {
    const request = mock(() => Promise.reject(new Error("connection lost")));
    expect(await restartServices(["api"], request as unknown as typeof fetch)).toBe(
      "Failed to restart api: connection lost",
    );
  });
});
