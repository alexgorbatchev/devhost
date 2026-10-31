import { z } from "zod";
import { pristineFetch } from "./pristineFetch";
import type { ChatTarget } from "./types";

const agentSchema = z.object({
  key: z.string(),
  harness: z.string(),
  state: z.enum(["working", "waiting", "idle", "unknown"]),
  name: z.string().optional(),
  subdirectory: z.string(),
  lastActivity: z.number(),
  isOwned: z.boolean(),
});
const responseSchema = z.object({ agents: z.array(agentSchema) });

export type RunningAgent = z.infer<typeof agentSchema>;

/** The agents working in the checkout, including ones devhost did not start. */
export async function readRunningAgents(
  pageURL: string,
  target: ChatTarget,
  signal: AbortSignal,
): Promise<readonly RunningAgent[]> {
  const query = new URLSearchParams({ pageURL, chatTarget: target });
  const response = await pristineFetch(`/__devhost__/agents?${query}`, { signal });
  if (!response.ok) throw new Error((await response.text()) || `Agent list failed (${response.status})`);
  return responseSchema.parse(await response.json()).agents;
}
