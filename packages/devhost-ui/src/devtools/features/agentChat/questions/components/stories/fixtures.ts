import type { IChatPendingRequest } from "../../../types";
export const fixture_codexQuestion: IChatPendingRequest = {
  requestId: 8,
  harness: "codex",
  method: "item/tool/requestUserInput",
  payload: {
    id: 8,
    method: "item/tool/requestUserInput",
    params: {
      threadId: "thread",
      turnId: "turn",
      itemId: "question",
      isBlocking: true,
      questions: [
        {
          id: "library",
          header: "Library",
          question: "Which library?",
          isOther: true,
          options: [{ label: "Native", description: "Use platform APIs" }],
        },
        { id: "secret", header: "Token", question: "Provide a token", isSecret: true, options: null },
      ],
    },
  },
};
export const fixture_claudeQuestion: IChatPendingRequest = {
  requestId: "claude-question",
  harness: "claude-code",
  method: "can_use_tool",
  payload: {
    type: "control_request",
    request_id: "claude-question",
    request: {
      subtype: "can_use_tool",
      tool_name: "AskUserQuestion",
      tool_use_id: "ask",
      input: {
        metadata: { source: "native" },
        questions: [
          {
            question: "Which features?",
            header: "Features",
            multiSelect: true,
            options: [
              { label: "Search", description: "Find content", preview: "**Search preview**" },
              { label: "History", description: "Keep history" },
            ],
          },
        ],
      },
    },
  },
};
