import { recoverySchema, worktreesSchema } from "./statusPageSchema";
import type { IRecoveryClient } from "./types";

export function createRecoveryClient(
  pageURL: string,
  request: typeof fetch,
  reload: IRecoveryClient["reload"],
): IRecoveryClient {
  async function send(action: string, signal: AbortSignal, body?: string): Promise<Response> {
    const headers = new Headers({ "X-Devhost-Recovery": action });
    if (body !== undefined) headers.set("Content-Type", "application/json");
    const response = await request(pageURL, {
      method: action === "restart" || body !== undefined ? "POST" : "GET",
      cache: "no-store",
      headers,
      body,
      signal,
    });
    if (!response.ok && action !== "probe") {
      throw new Error(
        action === "status" ? "Devhost is unavailable. Waiting to reconnect…" : (await response.text()).trim(),
      );
    }
    return response;
  }
  return {
    async readStatus(signal) {
      return recoverySchema.parse(await (await send("status", signal)).json());
    },
    async readWorktrees(signal) {
      return worktreesSchema.parse(await (await send("worktrees", signal)).json()).repositories;
    },
    async probe(signal) {
      return (await send("probe", signal)).status === 204;
    },
    async restart(signal) {
      await send("restart", signal);
    },
    async switchWorktree(selection, signal) {
      await send("worktrees", signal, JSON.stringify(selection));
    },
    reload,
  };
}
