import type { IChatPendingRequest } from "./types";
import type { ChatQuestionAnswers } from "./questions/types";
import { readChatQuestions } from "./readChatQuestions";

export function createChatQuestionResponse(request: IChatPendingRequest, answers: ChatQuestionAnswers): unknown {
  const parsed = readChatQuestions(request);
  if (!parsed) throw new Error("This native question request is unsupported.");
  const entries = parsed.questions.map((question) => {
    const selected = answers[question.id];
    if (
      !selected?.length ||
      selected.some((answer) => !answer.trim()) ||
      (!question.isMultiple && selected.length !== 1)
    )
      throw new Error(`Answer ${question.header} before submitting.`);
    if (!question.allowsOther && selected.some((answer) => !question.options.some((option) => option.label === answer)))
      throw new Error(`Choose one of the options for ${question.header}.`);
    return [question.id, selected] as const;
  });
  if (request.harness === "codex")
    return { answers: Object.fromEntries(entries.map(([id, selected]) => [id, { answers: [...selected] }])) };
  return {
    behavior: "allow",
    updatedInput: {
      ...parsed.input,
      answers: Object.fromEntries(entries.map(([id, selected]) => [id, selected.join(", ")])),
    },
  };
}
