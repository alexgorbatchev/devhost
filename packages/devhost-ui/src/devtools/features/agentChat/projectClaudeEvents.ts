import {
  fromThreadMessageLike,
  type DataMessagePart,
  type ImageMessagePart,
  type ReasoningMessagePart,
  type TextMessagePart,
  type ToolCallMessagePart,
} from "@assistant-ui/react";
import type { IChatEvent } from "./types";
import type { IProjectedMessage } from "./projectionTypes";
import { nativeArgs, nativeArray, nativeRecord, nativeString } from "./nativeValue";

type ClaudeMessagePart =
  | TextMessagePart
  | ReasoningMessagePart
  | ImageMessagePart
  | ToolCallMessagePart
  | DataMessagePart<unknown>;
function blockPart(value: unknown): ClaudeMessagePart {
  const block = nativeRecord(value);
  if (block.type === "text") return { type: "text", text: nativeString(block.text) };
  if (block.type === "thinking") return { type: "reasoning", text: nativeString(block.thinking) };
  if (block.type === "tool_use" || block.type === "server_tool_use") {
    const args = nativeArgs(block.input);
    return {
      type: "tool-call",
      toolCallId: nativeString(block.id),
      toolName: nativeString(block.name),
      args,
      argsText: JSON.stringify(args),
    };
  }
  if (block.type === "image") {
    const source = nativeRecord(block.source);
    if (source.type === "base64")
      return { type: "image", image: `data:${nativeString(source.media_type)};base64,${nativeString(source.data)}` };
    if (source.type === "url") return { type: "image", image: nativeString(source.url) };
  }
  return { type: "data", name: `claude-${nativeString(block.type)}`, data: value };
}

export function projectClaudeEvents(events: readonly IChatEvent[]): IProjectedMessage[] {
  const messages = new Map<string, IProjectedMessage>();
  const activeStreams = new Map<string, string>();
  const completedBlocks = new Map<string, number>();
  const toolResults = new Map<string, Record<string, unknown>>();
  const seenFrames = new Set<string>();
  const ensure = (id: string, role: IProjectedMessage["role"], parent: string): IProjectedMessage => {
    const previous = messages.get(id);
    if (previous) return previous;
    const message: IProjectedMessage = {
      id,
      role,
      content: [],
      ...(role === "assistant" ? { status: { type: "running" } } : {}),
      metadata: { custom: { parentToolUseId: parent || null } },
    };
    messages.set(id, message);
    return message;
  };
  for (const entry of events) {
    const frame = nativeRecord(entry.payload);
    const uuid = nativeString(frame.uuid);
    if (uuid && seenFrames.has(uuid)) continue;
    if (uuid) seenFrames.add(uuid);
    const parent = nativeString(frame.parent_tool_use_id);
    if (frame.type === "stream_event") {
      const event = nativeRecord(frame.event);
      if (event.type === "message_start") {
        const message = nativeRecord(event.message);
        const id = nativeString(message.id);
        if (id) {
          activeStreams.set(parent, id);
          ensure(id, "assistant", parent);
        }
      }
      const id = activeStreams.get(parent);
      const message = id ? messages.get(id) : undefined;
      if (!message) continue;
      const index = typeof event.index === "number" && event.index >= 0 ? event.index : 0;
      if (event.type === "content_block_start") message.content[index] = blockPart(event.content_block);
      if (event.type === "content_block_delta") {
        const delta = nativeRecord(event.delta);
        const previous = message.content[index];
        if (delta.type === "text_delta")
          message.content[index] = {
            type: "text",
            text: (previous?.type === "text" ? previous.text : "") + nativeString(delta.text),
          };
        else if (delta.type === "thinking_delta")
          message.content[index] = {
            type: "reasoning",
            text: (previous?.type === "reasoning" ? previous.text : "") + nativeString(delta.thinking),
          };
        else if (delta.type === "input_json_delta" && previous?.type === "tool-call") {
          const argsText =
            (previous.argsText === "{}" ? "" : (previous.argsText ?? "")) + nativeString(delta.partial_json);
          message.content[index] = { ...previous, args: undefined, argsText };
        }
      }
    } else if (frame.type === "assistant" || frame.type === "user") {
      const payload = nativeRecord(frame.message);
      const id = nativeString(payload.id) || uuid;
      const values =
        typeof payload.content === "string" ? [{ type: "text", text: payload.content }] : nativeArray(payload.content);
      const regular = values.filter((value) => nativeRecord(value).type !== "tool_result");
      for (const value of values) {
        const block = nativeRecord(value);
        if (block.type === "tool_result")
          toolResults.set(nativeString(block.tool_use_id), { ...block, structuredResult: frame.tool_use_result });
      }
      if (id && regular.length > 0) {
        const message = ensure(id, frame.type === "user" ? "user" : "assistant", parent);
        if (frame.type === "user") message.content = regular.map(blockPart);
        else {
          const offset = completedBlocks.get(id) ?? 0;
          regular.forEach((value, index) => {
            message.content[offset + index] = blockPart(value);
          });
          completedBlocks.set(id, offset + regular.length);
        }
        message.metadata.custom.nativeMessage = frame;
        if (typeof frame.error === "string")
          message.status = { type: "incomplete", reason: "error", error: { message: frame.error } };
      }
    } else if (frame.type === "result") {
      for (const message of messages.values())
        if (message.role === "assistant" && message.status?.type === "running") {
          message.status =
            frame.subtype === "success" && frame.is_error !== true
              ? { type: "complete", reason: "stop" }
              : {
                  type: "incomplete",
                  reason: "error",
                  error: {
                    message:
                      nativeString(frame.result) ||
                      nativeArray(frame.errors).map(nativeString).join("\n") ||
                      nativeString(frame.subtype),
                  },
                };
        }
    }
  }
  for (const message of messages.values())
    message.content = message.content.filter(Boolean).map((part) => {
      if (part.type !== "tool-call") return part;
      const result = toolResults.get(nativeString(part.toolCallId));
      return result
        ? { ...part, result: result.structuredResult ?? result.content, isError: result.is_error === true }
        : part;
    });
  const toolOwners = new Set<string>();
  for (const message of messages.values())
    for (const part of message.content)
      if (part.type === "tool-call" && part.toolCallId) toolOwners.add(part.toolCallId);
  const children = new Map<string, IProjectedMessage[]>();
  for (const message of messages.values()) {
    const parent = nativeString(message.metadata.custom.parentToolUseId);
    if (parent && toolOwners.has(parent)) children.set(parent, [...(children.get(parent) ?? []), message]);
  }
  const attach = (message: IProjectedMessage, ancestors: ReadonlySet<string>): IProjectedMessage => {
    const visited = new Set([...ancestors, message.id]);
    return {
      ...message,
      content: message.content.map((part) => {
        if (part.type !== "tool-call" || !part.toolCallId) return part;
        const nested = children.get(part.toolCallId)?.filter((child) => !visited.has(child.id));
        return nested
          ? {
              ...part,
              messages: nested.map((child) =>
                fromThreadMessageLike(
                  attach(child, visited),
                  child.id,
                  child.status ?? { type: "complete", reason: "unknown" },
                ),
              ),
            }
          : part;
      }),
    };
  };
  return [...messages.values()]
    .filter((message) => !toolOwners.has(nativeString(message.metadata.custom.parentToolUseId)))
    .map((message) => attach(message, new Set()));
}
