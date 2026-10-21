import type { IChatEvent, IChatPendingRequest } from "../../types";

export const fixture_commandRequest: IChatPendingRequest = {
  requestId: 7,
  harness: "codex",
  method: "item/commandExecution/requestApproval",
  payload: {
    id: 7,
    method: "item/commandExecution/requestApproval",
    params: {
      threadId: "thread",
      turnId: "turn",
      itemId: "command",
      command: "bun test",
      cwd: "/project",
      reason: "Run project tests",
    },
  },
};
export const fixture_fileRequest: IChatPendingRequest = {
  requestId: "file-approval",
  harness: "codex",
  method: "item/fileChange/requestApproval",
  payload: {
    id: "file-approval",
    method: "item/fileChange/requestApproval",
    params: { threadId: "thread", turnId: "turn", itemId: "file-change", reason: "Fix the greeting" },
  },
};
export const fixture_fileEvents: readonly IChatEvent[] = [
  {
    sequence: 1,
    payload: {
      method: "item/started",
      params: {
        threadId: "thread",
        turnId: "turn",
        item: {
          id: "file-change",
          type: "fileChange",
          status: "inProgress",
          changes: [{ path: "/project/app.ts", kind: { type: "update" }, diff: "-hello\n+hello world" }],
        },
      },
    },
  },
];
export const fixture_unknownRequest: IChatPendingRequest = {
  requestId: "unknown",
  harness: "claude-code",
  method: "future_interaction",
  payload: {
    type: "control_request",
    request_id: "unknown",
    request: { subtype: "future_interaction", details: "Native-only interaction" },
  },
};
