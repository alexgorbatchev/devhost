import { RESTART_STACK_PATH } from "./constants";
import { postControlAction } from "./postControlAction";
import type { FetchFunction } from "./pristineFetch";

export async function restartStack(request: FetchFunction): Promise<string | null> {
  return postControlAction({ path: RESTART_STACK_PATH, failureLabel: "Failed to restart stack" }, request);
}
