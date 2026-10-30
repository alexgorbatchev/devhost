import type { ChatMessagePart, IProjectedMessage } from "./projectionTypes";

function isBlankReasoning(part: ChatMessagePart): boolean {
  return part.type === "reasoning" && part.text.trim().length === 0;
}

function combineStatuses(
  first: IProjectedMessage["status"],
  second: IProjectedMessage["status"],
): IProjectedMessage["status"] {
  if (second?.type === "running") return second;
  if (first?.type === "running" || first?.type === "incomplete") return first;
  return second;
}

// The Thread groups tool calls only inside one message, but the harnesses report each tool step as its own message.
// Blank reasoning is dropped first: Claude Code attaches an empty thinking block to most steps, and it would split them.
export function groupSequentialToolCalls(messages: readonly IProjectedMessage[]): IProjectedMessage[] {
  const grouped: IProjectedMessage[] = [];
  for (const message of messages) {
    if (message.role !== "assistant") {
      grouped.push(message);
      continue;
    }
    const content = message.content.filter((part) => !isBlankReasoning(part));
    const previous = grouped.at(-1);
    const firstPart = content[0];
    if (
      previous?.role === "assistant" &&
      previous.content.at(-1)?.type === "tool-call" &&
      (!firstPart || firstPart.type === "tool-call")
    ) {
      grouped[grouped.length - 1] = {
        ...previous,
        content: [...previous.content, ...content],
        status: combineStatuses(previous.status, message.status),
      };
    } else if (firstPart || message.status?.type !== "complete") {
      grouped.push({ ...message, content });
    }
  }
  return grouped;
}
