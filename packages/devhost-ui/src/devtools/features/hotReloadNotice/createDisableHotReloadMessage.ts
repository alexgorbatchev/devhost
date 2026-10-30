import { HOT_RELOAD_CLIENT_LABELS } from "./constants";
import type { HotReloadClient } from "./types";

export function createDisableHotReloadMessage(client: HotReloadClient, pageURL: string): string {
  return [
    `Turn off hot reloading for this project's local development: ${pageURL} runs ${HOT_RELOAD_CLIENT_LABELS[client]} hot reloading, and your edits keep refreshing the page while I use it.`,
    "Disable hot module replacement, automatic page reloads, and server restarts on file changes in the development configuration. Leave application code alone.",
    "Tell me what you changed and how to turn it back on.",
  ].join("\n\n");
}
