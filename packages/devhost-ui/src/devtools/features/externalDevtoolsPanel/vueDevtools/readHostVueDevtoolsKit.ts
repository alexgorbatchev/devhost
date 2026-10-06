import type { IHostVueDevtoolsKit } from "./types";

/** Read the beta.1 plugin's existing runtime; never install a hook or runtime in the host. */
export function readHostVueDevtoolsKit(hostWindow: Window): IHostVueDevtoolsKit | undefined {
  if (!("__VUE_DEVTOOLS_VITE_RUNTIME__" in hostWindow)) return undefined;
  const state = hostWindow.__VUE_DEVTOOLS_VITE_RUNTIME__;
  if (typeof state !== "object" || state === null || !("kit" in state)) return undefined;
  return isHostVueDevtoolsKit(state.kit) ? state.kit : undefined;
}

function isHostVueDevtoolsKit(value: unknown): value is IHostVueDevtoolsKit {
  if (
    typeof value !== "object" ||
    value === null ||
    !("enabled" in value) ||
    value.enabled !== true ||
    !("runtime" in value)
  )
    return false;
  const runtime = value.runtime;
  return (
    typeof runtime === "object" &&
    runtime !== null &&
    "query" in runtime &&
    typeof runtime.query === "function" &&
    "subscribe" in runtime &&
    typeof runtime.subscribe === "function"
  );
}
