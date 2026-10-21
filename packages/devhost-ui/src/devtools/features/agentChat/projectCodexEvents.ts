import type { IChatEvent } from "./types";
import type { ChatMessagePart, IProjectedMessage } from "./projectionTypes";
import { nativeArgs, nativeArray, nativeRecord, nativeString } from "./nativeValue";

function itemParts(item: Record<string, unknown>, isCompleted: boolean): ChatMessagePart[] {
  const type = nativeString(item.type);
  if (type === "userMessage")
    return nativeArray(item.content).map((value): ChatMessagePart => {
      const input = nativeRecord(value);
      if (input.type === "text") return { type: "text", text: nativeString(input.text) };
      if (input.type === "image" && typeof input.url === "string") return { type: "image", image: input.url };
      return { type: "data", name: `codex-${nativeString(input.type)}`, data: value };
    });
  if (type === "agentMessage" || type === "plan") return [{ type: "text", text: nativeString(item.text) }];
  if (type === "reasoning")
    return [
      {
        type: "reasoning",
        text: [...nativeArray(item.summary), ...nativeArray(item.content)]
          .filter((value): value is string => typeof value === "string")
          .join("\n"),
      },
    ];
  if (
    [
      "commandExecution",
      "fileChange",
      "mcpToolCall",
      "dynamicToolCall",
      "collabAgentToolCall",
      "webSearch",
      "functionCallOutput",
    ].includes(type)
  ) {
    const args = type === "mcpToolCall" || type === "dynamicToolCall" ? nativeArgs(item.arguments) : nativeArgs(item);
    const result =
      item.result ?? item.output ?? item.contentItems ?? item.aggregatedOutput ?? (isCompleted ? item : undefined);
    return [
      {
        type: "tool-call",
        toolCallId: nativeString(item.id),
        toolName: nativeString(item.tool) || type,
        args,
        argsText: JSON.stringify(args),
        ...(result === undefined ? {} : { result }),
        isError:
          item.status === "failed" ||
          item.status === "declined" ||
          item.success === false ||
          (typeof item.exitCode === "number" && item.exitCode !== 0),
        artifact: item,
      },
    ];
  }
  return [{ type: "data", name: `codex-${type}`, data: item }];
}

export function projectCodexEvents(events: readonly IChatEvent[]): IProjectedMessage[] {
  const messages = new Map<string, IProjectedMessage>();
  const turns = new Map<string, Set<string>>();
  const upsert = (itemValue: unknown, turnId: string, isCompleted: boolean): void => {
    const item = nativeRecord(itemValue);
    const id = nativeString(item.id);
    if (!id) return;
    const role = item.type === "userMessage" ? "user" : "assistant";
    const previous = messages.get(id);
    messages.set(id, {
      id,
      role,
      content: itemParts(item, isCompleted),
      ...(role === "assistant"
        ? { status: isCompleted ? { type: "complete", reason: "stop" } : { type: "running" } }
        : {}),
      metadata: { custom: { ...previous?.metadata.custom, nativeItem: item, turnId } },
    });
    const ids = turns.get(turnId) ?? new Set<string>();
    ids.add(id);
    turns.set(turnId, ids);
  };
  for (const event of events) {
    const frame = nativeRecord(event.payload);
    const method = nativeString(frame.method);
    const params = nativeRecord(frame.params);
    const turnId = nativeString(params.turnId);
    if (method === "item/started" || method === "item/completed")
      upsert(params.item, turnId, method === "item/completed");
    else if (method === "thread/started" || typeof frame.result === "object") {
      const thread = nativeRecord(params.thread ?? nativeRecord(frame.result).thread);
      for (const value of nativeArray(thread.turns)) {
        const turn = nativeRecord(value);
        for (const item of nativeArray(turn.items)) upsert(item, nativeString(turn.id), turn.status !== "inProgress");
      }
    }
    if (method === "turn/started" || method === "turn/completed") {
      const turn = nativeRecord(params.turn);
      const id = nativeString(turn.id);
      const completed = method === "turn/completed";
      for (const item of nativeArray(turn.items)) upsert(item, id, completed);
      if (completed)
        for (const messageId of turns.get(id) ?? []) {
          const message = messages.get(messageId);
          if (!message || message.role !== "assistant") continue;
          message.status =
            turn.status === "interrupted"
              ? { type: "incomplete", reason: "cancelled" }
              : turn.status === "failed"
                ? { type: "incomplete", reason: "error", error: nativeArgs(turn.error) }
                : { type: "complete", reason: "stop" };
        }
    }
    const itemId = nativeString(params.itemId);
    const message = messages.get(itemId);
    if (message && typeof params.delta === "string") {
      if (method === "item/agentMessage/delta" || method === "item/plan/delta") {
        const part = message.content[0];
        message.content = [{ type: "text", text: (part?.type === "text" ? part.text : "") + params.delta }];
      } else if (method === "item/reasoning/textDelta" || method === "item/reasoning/summaryTextDelta") {
        const part = message.content[0];
        message.content = [{ type: "reasoning", text: (part?.type === "reasoning" ? part.text : "") + params.delta }];
      } else if (method === "item/commandExecution/outputDelta") {
        const part = message.content[0];
        if (part?.type === "tool-call")
          message.content = [
            {
              ...part,
              result: (typeof part.result === "string" ? part.result : "") + params.delta,
              isPreliminary: true,
            },
          ];
      }
    }
  }
  return [...messages.values()];
}
