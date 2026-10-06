import { z } from "zod";
import type { INativeReactTarget } from "./types";

const targetSchema = z.object({
  id: z.string(),
  type: z.string(),
  url: z.string(),
  parentId: z.string().optional(),
  webSocketDebuggerUrl: z.string().optional(),
});

export async function readNativeReactTargets(endpoint: string): Promise<INativeReactTarget[]> {
  const response = await fetch(new URL("/json/list", endpoint), {
    redirect: "error",
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`Owned browser target discovery failed: ${response.status}`);
  const value: unknown = await response.json();
  return z.array(targetSchema).parse(value);
}
