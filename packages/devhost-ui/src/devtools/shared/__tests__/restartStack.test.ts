import { describe, expect, it, mock } from "bun:test";

import { restartStack } from "../restartStack";

describe("restartStack", () => {
  it("requests a stack restart without listing individual services", async () => {
    const request = mock(async () => new Response(null, { status: 204 }));
    expect(await restartStack(request)).toBeNull();
    expect(request).toHaveBeenCalledWith("/__devhost__/restart-stack", {
      method: "POST",
    });
  });

  it.each([
    ["replacement failed\n", "Failed to restart stack: replacement failed"],
    ['{"error":"route rejected"}', "Failed to restart stack: route rejected"],
    ["", "Failed to restart stack: Internal Server Error"],
  ])("reports recovery failure %s", async (body, message) => {
    const request = mock(async () => new Response(body, { status: 500, statusText: "Internal Server Error" }));
    expect(await restartStack(request)).toBe(message);
  });

  it("reports a disconnected supervisor", async () => {
    const request = mock(() => Promise.reject(new Error("connection lost")));
    expect(await restartStack(request)).toBe("Failed to restart stack: connection lost");
  });
});
