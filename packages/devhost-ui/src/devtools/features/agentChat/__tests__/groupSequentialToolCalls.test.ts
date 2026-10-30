import { expect, test } from "bun:test";
import { groupSequentialToolCalls } from "../groupSequentialToolCalls";
import { projectChatEvents } from "../projectChatEvents";
import type { IChatEvent } from "../types";
import type { ChatMessagePart, IProjectedMessage } from "../projectionTypes";

function toolCall(toolCallId: string): ChatMessagePart {
  return { type: "tool-call", toolCallId, toolName: "Read", args: {}, argsText: "{}" };
}

function assistant(
  id: string,
  content: ChatMessagePart[],
  status: IProjectedMessage["status"] = { type: "complete", reason: "stop" },
): IProjectedMessage {
  return { id, role: "assistant", content, status, metadata: { custom: {} } };
}

test("Claude steps with blank thinking become one message of tool calls", () => {
  const step = (sequence: number, id: string): IChatEvent => ({
    sequence,
    payload: {
      type: "assistant",
      uuid: `frame-${id}`,
      parent_tool_use_id: null,
      message: {
        id,
        content: [
          { type: "thinking", thinking: "" },
          { type: "tool_use", id: `tool-${id}`, name: "Read", input: {} },
        ],
      },
    },
  });
  const events = [
    step(1, "first"),
    step(2, "second"),
    {
      sequence: 3,
      payload: {
        type: "assistant",
        uuid: "frame-reply",
        parent_tool_use_id: null,
        message: { id: "reply", content: [{ type: "text", text: "Done" }] },
      },
    },
    { sequence: 4, payload: { type: "result", subtype: "success", is_error: false } },
  ];
  const { messages } = projectChatEvents("claude-code", events, []);
  expect(messages.map((message) => message.id)).toEqual(["first", "reply"]);
  expect(messages[0]).toMatchObject({
    content: [{ toolCallId: "tool-first" }, { toolCallId: "tool-second" }],
    status: { type: "complete" },
  });
  expect(messages[0]?.content).toHaveLength(2);
});

test("Codex items keep a tool sequence together across blank reasoning items", () => {
  const item = (sequence: number, value: Record<string, unknown>): IChatEvent => ({
    sequence,
    payload: { method: "item/completed", params: { turnId: "turn", item: value } },
  });
  const command = (id: string): Record<string, unknown> => ({ type: "commandExecution", id, status: "completed" });
  const events = [
    item(1, { type: "reasoning", id: "thought", summary: [], content: [] }),
    item(2, command("first")),
    item(3, { type: "reasoning", id: "second-thought", summary: [], content: [] }),
    item(4, command("second")),
  ];
  const { messages } = projectChatEvents("codex", events, []);
  expect(messages.map((message) => message.id)).toEqual(["first"]);
  expect(messages[0]).toMatchObject({ content: [{ toolCallId: "first" }, { toolCallId: "second" }] });
  expect(messages[0]?.content).toHaveLength(2);
});

test("text, visible reasoning and user messages each end a sequence", () => {
  const user: IProjectedMessage = {
    id: "user",
    role: "user",
    content: [{ type: "text", text: "Continue" }],
    metadata: { custom: {} },
  };
  const messages = groupSequentialToolCalls([
    assistant("first", [toolCall("first")]),
    assistant("narration", [{ type: "text", text: "Now the tests" }, toolCall("after-text")]),
    assistant("thought", [{ type: "reasoning", text: "The test is stale" }, toolCall("after-thought")]),
    user,
    assistant("next-turn", [toolCall("next-turn")]),
  ]);
  expect(messages.map((message) => message.id)).toEqual(["first", "narration", "thought", "user", "next-turn"]);
});

test("a sequence reports running until its last step ends, then its failure", () => {
  const failed: IProjectedMessage["status"] = { type: "incomplete", reason: "cancelled" };
  const running: IProjectedMessage["status"] = { type: "running" };
  const combine = (first: IProjectedMessage["status"], second: IProjectedMessage["status"]): unknown =>
    groupSequentialToolCalls([
      assistant("first", [toolCall("first")], first),
      assistant("second", [toolCall("second")], second),
    ])
      .map((message) => message.status)
      .at(0);
  expect(combine(undefined, running)).toEqual(running);
  expect(combine(running, { type: "complete", reason: "stop" })).toEqual(running);
  expect(combine(failed, running)).toEqual(running);
  expect(combine(failed, failed)).toEqual(failed);
  expect(combine({ type: "complete", reason: "stop" }, failed)).toEqual(failed);
});

test("an interrupted turn keeps its sequence grouped", () => {
  const step = (sequence: number, id: string): IChatEvent => ({
    sequence,
    payload: {
      method: "item/started",
      params: { turnId: "turn", item: { type: "commandExecution", id, status: "inProgress" } },
    },
  });
  const events = [
    step(1, "first"),
    step(2, "second"),
    {
      sequence: 3,
      payload: { method: "turn/completed", params: { turn: { id: "turn", status: "interrupted", items: [] } } },
    },
  ];
  expect(projectChatEvents("codex", events, []).messages).toMatchObject([
    { id: "first", status: { type: "incomplete", reason: "cancelled" } },
  ]);
});

test("a step without visible content stays only while it can still show something", () => {
  const blank: ChatMessagePart = { type: "reasoning", text: "  " };
  const failed: IProjectedMessage["status"] = { type: "incomplete", reason: "error" };
  const messages = groupSequentialToolCalls([
    assistant("finished", [blank]),
    assistant("streaming", [], { type: "running" }),
    assistant("failed", [blank], failed),
  ]);
  expect(messages.map((message) => message.id)).toEqual(["streaming", "failed"]);
  expect(
    groupSequentialToolCalls([assistant("tools", [toolCall("first")]), assistant("next", [], { type: "running" })]),
  ).toMatchObject([{ id: "tools", status: { type: "running" } }]);
});
