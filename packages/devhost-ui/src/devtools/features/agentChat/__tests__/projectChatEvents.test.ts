import { expect, test } from "bun:test";
import { fromThreadMessageLike } from "@assistant-ui/react";
import { projectChatEvents } from "../projectChatEvents";
import type { IChatEvent } from "../types";
import {
  fixture_claudeAuthFailure,
  fixture_claudeEchoFailure,
  fixture_claudeInheritedRequests,
  fixture_codexConversation,
} from "./fixtures";

test("actual Claude replay preserves the submitted user text before a native authentication error", () => {
  const projection = projectChatEvents("claude-code", fixture_claudeEchoFailure, []);
  expect(projection.messages).toMatchObject([
    {
      id: "5b0c4097-da0a-496d-8064-bfb63cbfe196",
      role: "user",
      content: [
        { type: "text", text: "Reply with exactly DEVHOST_CHAT_ECHO_OK. Do not use any tools or modify files." },
      ],
    },
    {
      role: "assistant",
      content: [{ type: "text", text: "Not logged in · Please run /login" }],
      status: { type: "incomplete", reason: "error" },
    },
  ]);
});

test("restores inherited native Claude requests, deduplicates replay and gates resolved IDs", () => {
  const restored = projectChatEvents("claude-code", fixture_claudeInheritedRequests, ["inherited", "dialog-one"]);
  expect(restored.pendingRequests).toMatchObject([
    {
      requestId: "inherited",
      method: "can_use_tool",
      payload: {
        type: "control_request",
        request_id: "inherited",
        request: { tool_name: "Read", input: { file_path: "example.txt" } },
      },
    },
    {
      requestId: "dialog-one",
      method: "request_user_dialog",
      payload: { type: "control_request", request_id: "dialog-one", request: { title: "Native dialog" } },
    },
  ]);
  expect(
    projectChatEvents("claude-code", fixture_claudeInheritedRequests, ["dialog-one"]).pendingRequests,
  ).toHaveLength(1);
  expect(projectChatEvents("claude-code", fixture_claudeInheritedRequests, []).pendingRequests).toEqual([]);
});

test("projects the actual installed Codex transcript without duplicating final deltas", () => {
  const projection = projectChatEvents("codex", fixture_codexConversation, []);
  expect(projection.messages).toMatchObject([
    { role: "user" },
    { role: "assistant", content: [{ type: "text", text: "DEVHOST_CHAT_OK" }], status: { type: "complete" } },
  ]);
});
test("actual Claude authentication failure remains an error despite subtype success", () => {
  const projection = projectChatEvents("claude-code", fixture_claudeAuthFailure, []);
  expect(projection.messages).toMatchObject([
    {
      content: [{ type: "text", text: "Not logged in · Please run /login" }],
      status: { type: "incomplete", reason: "error" },
    },
  ]);
});

test("Codex authoritative completion replaces deltas and preserves all native frames", () => {
  const events: IChatEvent[] = [
    {
      sequence: 1,
      payload: {
        method: "item/started",
        params: {
          threadId: "thread",
          turnId: "turn",
          item: { type: "agentMessage", id: "answer", text: "" },
          startedAtMs: 1000,
        },
      },
    },
    {
      sequence: 2,
      payload: {
        method: "item/agentMessage/delta",
        params: { threadId: "thread", turnId: "turn", itemId: "answer", delta: "Partial" },
      },
    },
    {
      sequence: 3,
      payload: {
        method: "item/completed",
        params: {
          threadId: "thread",
          turnId: "turn",
          item: { type: "agentMessage", id: "answer", text: "Authoritative answer" },
          completedAtMs: 2000,
        },
      },
    },
  ];
  const result = projectChatEvents("codex", events, []);
  expect(result.messages).toMatchObject([
    { id: "answer", content: [{ type: "text", text: "Authoritative answer" }], status: { type: "complete" } },
  ]);
  expect(result.events).toEqual(events);
});
test("historical requests never resurrect after an answered snapshot", () => {
  const events: IChatEvent[] = [
    {
      sequence: 1,
      payload: {
        id: 4,
        method: "item/commandExecution/requestApproval",
        params: { itemId: "command", command: "pwd" },
      },
    },
  ];
  expect(projectChatEvents("codex", events, []).pendingRequests).toEqual([]);
  expect(projectChatEvents("codex", events, [4]).pendingRequests).toMatchObject([
    { requestId: 4, method: "item/commandExecution/requestApproval", payload: events[0]?.payload },
  ]);
  expect(projectChatEvents("codex", events, ["4"]).pendingRequests).toEqual([]);
});
test("Claude streams ordered native blocks, reconciles final blocks and tool results", () => {
  const events: IChatEvent[] = [
    {
      sequence: 1,
      payload: {
        type: "stream_event",
        event: { type: "message_start", message: { id: "msg", role: "assistant", content: [] } },
      },
    },
    {
      sequence: 2,
      payload: {
        type: "stream_event",
        event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      },
    },
    {
      sequence: 3,
      payload: {
        type: "stream_event",
        event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } },
      },
    },
    {
      sequence: 4,
      payload: {
        type: "assistant",
        uuid: "frame-one",
        message: { id: "msg", content: [{ type: "text", text: "Hello" }] },
        parent_tool_use_id: null,
      },
    },
    {
      sequence: 5,
      payload: {
        type: "assistant",
        uuid: "frame-two",
        message: { id: "msg", content: [{ type: "tool_use", id: "tool", name: "Read", input: { file_path: "a.ts" } }] },
        parent_tool_use_id: null,
      },
    },
    {
      sequence: 6,
      payload: {
        type: "user",
        uuid: "tool-result",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "tool", content: "source", is_error: false }],
        },
        parent_tool_use_id: null,
      },
    },
    {
      sequence: 7,
      payload: { type: "result", subtype: "success", result: "Hello", session_id: "session", uuid: "result" },
    },
  ];
  expect(projectChatEvents("claude-code", events, []).messages).toMatchObject([
    {
      id: "msg",
      content: [
        { type: "text", text: "Hello" },
        { type: "tool-call", toolCallId: "tool", result: "source" },
      ],
      status: { type: "complete" },
    },
  ]);
});
test("Claude child messages stay in their actual parent task transcript", () => {
  const events: IChatEvent[] = [
    {
      sequence: 1,
      payload: {
        type: "assistant",
        uuid: "parent-frame",
        parent_tool_use_id: null,
        message: {
          id: "parent",
          content: [{ type: "tool_use", id: "task", name: "Agent", input: { description: "Inspect" } }],
        },
      },
    },
    {
      sequence: 2,
      payload: {
        type: "assistant",
        uuid: "child-frame",
        parent_tool_use_id: "task",
        message: { id: "child", content: [{ type: "text", text: "Nested inspection" }] },
      },
    },
    { sequence: 3, payload: { type: "result", subtype: "success", is_error: false } },
  ];
  expect(projectChatEvents("claude-code", events, []).messages).toMatchObject([
    {
      id: "parent",
      content: [
        {
          type: "tool-call",
          toolCallId: "task",
          messages: [{ id: "child", content: [{ type: "text", text: "Nested inspection" }] }],
        },
      ],
    },
  ]);
  expect(projectChatEvents("claude-code", events, []).messages).toHaveLength(1);
});
test("Claude streamed tool JSON uses the native runtime partial argument parser", () => {
  const events: IChatEvent[] = [
    { sequence: 1, payload: { type: "stream_event", event: { type: "message_start", message: { id: "stream" } } } },
    {
      sequence: 2,
      payload: {
        type: "stream_event",
        event: {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "read", name: "Read", input: {} },
        },
      },
    },
    {
      sequence: 3,
      payload: {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: '{"file_path":"a.ts"}' },
        },
      },
    },
  ];
  const messages = projectChatEvents("claude-code", events, []).messages;
  expect(
    messages.map((message) => fromThreadMessageLike(message, "stream", { type: "running" }).content),
  ).toMatchObject([[{ type: "tool-call", args: { file_path: "a.ts" } }]]);
});
test("Claude result is_error completes the actual failed turn even without assistant error metadata", () => {
  const events: IChatEvent[] = [
    {
      sequence: 1,
      payload: {
        type: "assistant",
        uuid: "error-frame",
        message: { id: "error-msg", content: [{ type: "text", text: "Not logged in" }] },
      },
    },
    { sequence: 2, payload: { type: "result", subtype: "success", is_error: true, result: "Not logged in" } },
  ];
  expect(projectChatEvents("claude-code", events, []).messages).toMatchObject([
    { status: { type: "incomplete", reason: "error" } },
  ]);
});
test("Codex command output remains preliminary until authoritative completion and cancellation", () => {
  const started = {
    type: "commandExecution",
    id: "command",
    command: "pwd",
    commandActions: [],
    cwd: "/project",
    status: "inProgress",
  };
  const events: IChatEvent[] = [
    { sequence: 1, payload: { method: "item/started", params: { turnId: "turn", item: started } } },
    {
      sequence: 2,
      payload: { method: "item/commandExecution/outputDelta", params: { itemId: "command", delta: "partial" } },
    },
  ];
  expect(projectChatEvents("codex", events, []).messages).toMatchObject([
    { status: { type: "running" }, content: [{ type: "tool-call", result: "partial", isPreliminary: true }] },
  ]);
  events.push({
    sequence: 3,
    payload: {
      method: "item/completed",
      params: { turnId: "turn", item: { ...started, status: "completed", aggregatedOutput: "/project", exitCode: 0 } },
    },
  });
  expect(projectChatEvents("codex", events, []).messages).toMatchObject([
    { content: [{ result: "/project", isError: false }] },
  ]);
  events.push({
    sequence: 4,
    payload: { method: "turn/completed", params: { turn: { id: "turn", status: "interrupted", items: [] } } },
  });
  expect(projectChatEvents("codex", events, []).messages).toMatchObject([
    { status: { type: "incomplete", reason: "cancelled" } },
  ]);
});
test("replayed duplicate events are ordered once and unrecognized native items stay inspectable", () => {
  const native = {
    method: "item/completed",
    params: { item: { id: "future", type: "futureNativeItem", nested: { field: "preserved" } } },
  };
  const result = projectChatEvents(
    "codex",
    [
      { sequence: 2, payload: native },
      { sequence: 1, payload: { method: "unrecognized/notification", params: { exact: true } } },
      { sequence: 2, payload: native },
    ],
    [],
  );
  expect(result.events.map((event) => event.sequence)).toEqual([1, 2]);
  expect(result.messages).toMatchObject([{ content: [{ type: "data", data: native.params.item }] }]);
});
