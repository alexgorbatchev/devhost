import { DEVTOOLS_CONTROL_TOKEN_HEADER_NAME, CONTROL_PATH_PREFIX } from "../../shared/constants";
import type { HealthResponse } from "../../shared/types";
import { parseHealthResponse } from "./parseHealthResponse";

interface IWorktreeRequestResult {
  health: HealthResponse | null;
  error: string | null;
}

interface IWorktreeSelection {
  repositoryId: string;
  path: string;
}

export async function requestWorktrees(
  controlToken: string,
  request: typeof fetch,
  selection?: IWorktreeSelection,
): Promise<IWorktreeRequestResult> {
  try {
    const response = await request(`${CONTROL_PATH_PREFIX}/worktrees`, {
      method: selection === undefined ? "GET" : "POST",
      headers: { [DEVTOOLS_CONTROL_TOKEN_HEADER_NAME]: controlToken, "content-type": "application/json" },
      body: selection === undefined ? undefined : JSON.stringify(selection),
    });
    const text = await response.text();
    if (!response.ok) return { health: null, error: text.trim() || response.statusText };
    if (selection !== undefined) return { health: null, error: null };
    const health = parseHealthResponse(text);
    return { health, error: health === null ? "devhost returned malformed worktree data." : null };
  } catch (error: unknown) {
    return { health: null, error: error instanceof Error ? error.message : String(error) };
  }
}
