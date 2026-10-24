import { expect, mock, test } from "bun:test";
import { createRecoveryClient } from "../createRecoveryClient";

interface IRequestRecord {
  action: string | null;
  method: string;
  url: string;
  contentType: string | null;
  body: string;
}

test("uses the original URL and recovery protocol, validates JSON, and reports server errors", async () => {
  const requests: IRequestRecord[] = [];
  let status = 200;
  let content: string | null = JSON.stringify({
    stack: "shop",
    service: "web",
    phase: "failed",
    title: "web exited",
    message: "Exit code 1",
    address: "localhost:1234",
    canRestart: true,
    logs: null,
    repositories: null,
  });
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      requests.push({
        action: request.headers.get("X-Devhost-Recovery"),
        method: request.method,
        url: request.url,
        contentType: request.headers.get("Content-Type"),
        body: await request.text(),
      });
      return new Response(content, { status });
    },
  });
  try {
    const url = new URL("/nested/path?query=kept", server.url).href;
    const reload = mock(() => {});
    const client = createRecoveryClient(url, fetch, reload);
    const signal = new AbortController().signal;
    const state = await client.readStatus(signal);
    expect(state.title).toBe("web exited");
    expect(state.logs).toEqual([]);
    expect(await client.readWorktrees(signal)).toEqual([]);
    expect(await client.probe(signal)).toBe(false);
    status = 204;
    content = null;
    expect(await client.probe(signal)).toBe(true);
    await client.restart(signal);
    const selection = { repositoryId: "repo", path: "/feature", stopOwnerId: "owner" };
    await client.switchWorktree(selection, signal);
    expect(requests.map((request) => [request.action, request.method])).toEqual([
      ["status", "GET"],
      ["worktrees", "GET"],
      ["probe", "GET"],
      ["probe", "GET"],
      ["restart", "POST"],
      ["worktrees", "POST"],
    ]);
    expect(requests.every((request) => request.url === url)).toBe(true);
    expect(requests.at(-1)?.contentType).toBe("application/json");
    expect(JSON.parse(requests.at(-1)?.body ?? "")).toEqual(selection);
    expect(reload).not.toHaveBeenCalled();
    status = 409;
    content = "Ownership changed\n";
    await expect(client.switchWorktree(selection, signal)).rejects.toThrow("Ownership changed");
    await expect(client.readStatus(signal)).rejects.toThrow("Devhost is unavailable");
    status = 200;
    content = '{"logs": false}';
    await expect(client.readStatus(signal)).rejects.toThrow();
    client.reload();
    expect(reload).toHaveBeenCalledTimes(1);
  } finally {
    await server.stop(true);
  }
});
