import { z } from "zod";
import type { IChatPendingRequest } from "./types";
import type { IChatQuestions } from "./questions/types";
import { nativeRecord } from "./nativeValue";

const option = z.object({ label: z.string(), description: z.string(), preview: z.string().optional() });
const codex = z.object({
  params: z.looseObject({
    itemId: z.string(),
    threadId: z.string(),
    turnId: z.string(),
    isBlocking: z.boolean(),
    questions: z
      .array(
        z.object({
          id: z.string(),
          header: z.string(),
          question: z.string(),
          isOther: z.boolean().default(false),
          isSecret: z.boolean().default(false),
          options: z.array(option).nullish(),
        }),
      )
      .min(1),
  }),
});
const claude = z.object({
  request: z.object({
    subtype: z.literal("can_use_tool"),
    tool_name: z.literal("AskUserQuestion"),
    input: z.looseObject({
      questions: z
        .array(
          z.object({
            question: z.string(),
            header: z.string(),
            options: z.array(option).min(2).max(4),
            multiSelect: z.boolean(),
          }),
        )
        .min(1)
        .max(4),
    }),
  }),
});

export function readChatQuestions(request: IChatPendingRequest): IChatQuestions | null {
  if (request.harness === "codex" && request.method === "item/tool/requestUserInput") {
    const parsed = codex.safeParse(request.payload);
    if (!parsed.success) return null;
    const questions = parsed.data.params.questions.map((question) => ({
      id: question.id,
      header: question.header,
      prompt: question.question,
      options: question.options ?? [],
      isMultiple: false,
      isSecret: question.isSecret,
      allowsOther: question.isOther || !question.options?.length,
    }));
    return new Set(questions.map((question) => question.id)).size === questions.length
      ? { questions, input: parsed.data.params }
      : null;
  }
  if (request.harness === "claude-code" && request.method === "can_use_tool") {
    const parsed = claude.safeParse(request.payload);
    if (!parsed.success) return null;
    const questions = parsed.data.request.input.questions.map((question) => ({
      id: question.question,
      header: question.header,
      prompt: question.question,
      options: question.options,
      isMultiple: question.multiSelect,
      isSecret: false,
      allowsOther: true,
    }));
    return new Set(questions.map((question) => question.id)).size === questions.length
      ? { questions, input: nativeRecord(nativeRecord(nativeRecord(request.payload).request).input) }
      : null;
  }
  return null;
}
