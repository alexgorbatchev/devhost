import type { ChatCommand } from "./types";

export function encodeChatCommand(command: ChatCommand): string {
  const payload = JSON.stringify(command);
  if (new TextEncoder().encode(payload).byteLength > 8 * 1024 * 1024) {
    throw new Error(
      "The message and snapshot exceed the 8 MiB limit. Reduce the page context or capture size and retry.",
    );
  }
  return payload;
}
