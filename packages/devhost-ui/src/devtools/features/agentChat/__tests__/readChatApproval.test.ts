import { describe, expect, test } from "bun:test";
import { readChatApproval } from "../readChatApproval";

describe("readChatApproval", () => {
  test("preserves command details and grants only the requested command", () => {
    const payload = {
      id: 7,
      method: "item/commandExecution/requestApproval",
      params: { itemId: "command-1", command: "bun test", cwd: "/project", reason: "Run the project tests" },
    };
    expect(readChatApproval({ requestId: 7, harness: "codex", method: payload.method, payload })).toEqual({
      title: "Run command",
      description: "Run the project tests",
      details: payload.params,
      allow: { decision: "accept" },
      deny: { decision: "decline" },
    });
  });

  test("does not widen a permission request beyond the current turn", () => {
    const permissions = { network: { enabled: true }, fileSystem: { write: ["/project/build"] } };
    const payload = {
      id: "access-1",
      method: "item/permissions/requestApproval",
      params: { permissions, reason: null, cwd: "/project" },
    };
    expect(readChatApproval({ requestId: "access-1", harness: "codex", method: payload.method, payload })).toEqual({
      title: "Grant access for this turn",
      description: undefined,
      details: payload.params,
      allow: { permissions, scope: "turn" },
      deny: { permissions: {}, scope: "turn" },
    });
  });

  test("preserves Claude tool input and leaves future permissions unchanged", () => {
    const input = { file_path: "/project/app.ts", old_string: "before", new_string: "after" };
    const payload = {
      type: "control_request",
      request_id: "permission-1",
      request: { subtype: "can_use_tool", tool_name: "Edit", input },
    };
    expect(
      readChatApproval({ requestId: "permission-1", harness: "claude-code", method: "can_use_tool", payload }),
    ).toEqual({
      title: "Allow Edit",
      description: undefined,
      details: payload.request,
      allow: { behavior: "allow", updatedInput: input },
      deny: { behavior: "deny", message: "Denied by the user." },
    });
  });

  test("keeps user questions out of generic tool approval", () => {
    const payload = {
      type: "control_request",
      request_id: "question-1",
      request: { subtype: "can_use_tool", tool_name: "AskUserQuestion", input: { questions: [] } },
    };
    expect(
      readChatApproval({ requestId: "question-1", harness: "claude-code", method: "can_use_tool", payload }),
    ).toBeNull();
  });

  test("does not offer generic approval for requests requiring a dedicated interaction", () => {
    const payload = {
      type: "control_request",
      request_id: "interactive-1",
      request: { subtype: "can_use_tool", tool_name: "SpecialTool", input: {}, requires_user_interaction: true },
    };
    expect(
      readChatApproval({ requestId: "interactive-1", harness: "claude-code", method: "can_use_tool", payload }),
    ).toBeNull();
  });

  test("strips terminal styling from Claude's consent text", () => {
    const payload = {
      request: {
        subtype: "can_use_tool",
        tool_name: "Bash",
        input: { command: "bun test" },
        title: "\u001b[31mRun tests\u001b[0m",
        decision_reason: "\u001b[1mNeeds project access\u001b[0m",
      },
    };
    expect(
      readChatApproval({ requestId: "styled-1", harness: "claude-code", method: "can_use_tool", payload })?.description,
    ).toBe("Needs project access");
    expect(
      readChatApproval({ requestId: "styled-1", harness: "claude-code", method: "can_use_tool", payload })?.title,
    ).toBe("Run tests");
  });

  test("does not invent a response for malformed or unknown native requests", () => {
    expect(
      readChatApproval({ requestId: 3, harness: "codex", method: "future/request", payload: { params: {} } }),
    ).toBeNull();
    expect(
      readChatApproval({
        requestId: 3,
        harness: "codex",
        method: "item/permissions/requestApproval",
        payload: { params: { permissions: null } },
      }),
    ).toBeNull();
    expect(
      readChatApproval({
        requestId: "bad",
        harness: "claude-code",
        method: "can_use_tool",
        payload: { request: { subtype: "can_use_tool", tool_name: "Edit", input: "bad" } },
      }),
    ).toBeNull();
  });
});
