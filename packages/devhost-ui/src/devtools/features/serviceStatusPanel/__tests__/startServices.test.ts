import { describe, expect, it, mock } from "bun:test";

import type { FetchFunction } from "../../../shared/pristineFetch";
import { startServices } from "../startServices";

describe("startServices", () => {
  it("posts the services to start without credentials", async () => {
    const request = mock<FetchFunction>(async () => new Response(null, { status: 204 }));
    expect(await startServices(["docs", "admin"], request)).toBeNull();
    expect(request).toHaveBeenCalledWith("/__devhost__/start-service", {
      body: '{"serviceNames":["docs","admin"]}',
      headers: { "content-type": "application/json" },
      method: "POST",
    });
  });

  it("reports why a service did not start", async () => {
    const request = mock<FetchFunction>(
      async () => new Response("start reloaded service docs: exit 7\n", { status: 500 }),
    );
    expect(await startServices(["docs"], request)).toBe("Failed to start docs: start reloaded service docs: exit 7");
  });

  it("reports a disconnected control server", async () => {
    const request = mock<FetchFunction>(() => Promise.reject(new Error("connection lost")));
    expect(await startServices(["docs"], request)).toBe("Failed to start docs: connection lost");
  });
});
