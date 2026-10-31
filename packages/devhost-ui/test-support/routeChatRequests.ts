import type { FetchFunction } from "../src/devtools/shared/pristineFetch";

const AGENTS_PATH = "/__devhost__/agents";

function isAgentListRequest(input: Parameters<FetchFunction>[0]): boolean {
  return new URL(String(input), window.location.href).pathname === AGENTS_PATH;
}

/**
 * Answers the running agents list and hands every other request to `next`. The list is advisory, so tests that answer
 * chat requests in order keep it out of their queue.
 */
export function answerAgentList(next: FetchFunction, agents: readonly unknown[] = []): FetchFunction {
  return async (input, init) => (isAgentListRequest(input) ? Response.json({ agents }) : next(input, init));
}

/** Fails the running agents list, as an offline control server does, and hands every other request to `next`. */
export function failAgentList(next: FetchFunction): FetchFunction {
  return async (input, init) => {
    if (isAgentListRequest(input)) throw new Error("The agent list is unavailable.");
    return next(input, init);
  };
}

/** Answers the session list with `sessions`, and a session start with `started`. */
export function answerChatSessions(sessions: readonly unknown[], started: unknown): FetchFunction {
  return async (_input, init) => Response.json(init?.method === "POST" ? started : { sessions });
}

/** The newest open connection; throwing lets `waitFor` retry until one exists. */
export function readNewest<TConnection>(connections: readonly TConnection[]): TConnection {
  const newest = connections.at(-1);
  if (newest === undefined) throw new Error("No connection has opened.");
  return newest;
}
