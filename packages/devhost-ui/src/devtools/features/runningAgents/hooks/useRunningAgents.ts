import { useEffect, useState } from "react";
import { readRunningAgents, type RunningAgent } from "../../../shared/readRunningAgents";
import type { ChatTarget } from "../../../shared/types";
import { AGENT_LIST_REFRESH_MS } from "../constants";

/** Refreshes while the page is visible, because each scan covers every agent on the machine. */
export function useRunningAgents(isEnabled: boolean, target: ChatTarget): readonly RunningAgent[] {
  const [agents, setAgents] = useState<readonly RunningAgent[]>([]);
  useEffect(() => {
    if (!isEnabled) {
      setAgents([]);
      return;
    }
    const lifetime = new AbortController();
    const refresh = (): void => {
      if (document.visibilityState !== "visible") return;
      readRunningAgents(window.location.href, target, lifetime.signal).then(setAgents, () => {
        // The list is advisory: a failed scan leaves the last one, and the next refresh retries.
      });
    };
    refresh();
    const interval = setInterval(refresh, AGENT_LIST_REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      lifetime.abort();
      clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [isEnabled, target]);
  return agents;
}
