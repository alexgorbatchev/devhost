import assert from "node:assert/strict";

export async function allocateGuidePort(): Promise<number> {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = server.port;
  assert(port);
  await server.stop(true);
  return port;
}
