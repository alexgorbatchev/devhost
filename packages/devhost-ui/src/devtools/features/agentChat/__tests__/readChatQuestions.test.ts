import { expect, test } from "bun:test";
import { readChatQuestions } from "../readChatQuestions";
import { createChatQuestionResponse } from "../createChatQuestionResponse";
import type { IChatPendingRequest } from "../types";

const codex: IChatPendingRequest = {
  requestId: 3,
  harness: "codex",
  method: "item/tool/requestUserInput",
  payload: {
    id: 3,
    method: "item/tool/requestUserInput",
    params: {
      itemId: "question",
      threadId: "thread",
      turnId: "turn",
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
const claude: IChatPendingRequest = {
  requestId: "ask",
  harness: "claude-code",
  method: "can_use_tool",
  payload: {
    type: "control_request",
    request_id: "ask",
    request: {
      subtype: "can_use_tool",
      tool_name: "AskUserQuestion",
      input: {
        metadata: { source: "native" },
        questions: [
          {
            question: "Which features?",
            header: "Features",
            multiSelect: true,
            options: [
              { label: "Search", description: "Find content", preview: "**Search**" },
              { label: "History", description: "Keep history" },
            ],
          },
        ],
      },
    },
  },
};
test("Codex questions retain native IDs, secret inputs, and optional free text", () => {
  expect(readChatQuestions(codex)?.questions).toMatchObject([
    { id: "library", allowsOther: true, isSecret: false },
    { id: "secret", isSecret: true, options: [], allowsOther: true },
  ]);
  expect(
    createChatQuestionResponse(codex, { library: ["A maintained alternative"], secret: ["private input"] }),
  ).toEqual({
    answers: { library: { answers: ["A maintained alternative"] }, secret: { answers: ["private input"] } },
  });
});
test("Claude multi-choice answers preserve exact input and native comma-separated answer contract", () => {
  expect(readChatQuestions(claude)?.questions).toMatchObject([
    { id: "Which features?", isMultiple: true, allowsOther: true, options: [{ preview: "**Search**" }, {}] },
  ]);
  expect(createChatQuestionResponse(claude, { "Which features?": ["Search", "History"] })).toMatchObject({
    behavior: "allow",
    updatedInput: {
      metadata: { source: "native" },
      questions: [{ question: "Which features?" }],
      answers: { "Which features?": "Search, History" },
    },
  });
});
test("malformed, ambiguous, and unknown interactive requests stay unsupported", () => {
  expect(readChatQuestions({ ...codex, method: "future/request" })).toBeNull();
  expect(
    readChatQuestions({
      ...claude,
      payload: { request: { subtype: "can_use_tool", tool_name: "OtherTool", input: {} } },
    }),
  ).toBeNull();
  expect(readChatQuestions({ ...codex, payload: { params: { questions: [] } } })).toBeNull();
  expect(() => createChatQuestionResponse(codex, { library: ["Native"] })).toThrow();
  expect(() => createChatQuestionResponse(codex, { library: ["Native"], secret: ["one", "two"] })).toThrow();
});
