import type { IChatQuestionSelection } from "./types";
export function getChatQuestionAnswers(selection: IChatQuestionSelection | undefined): string[] {
  if (!selection) return [];
  return [...new Set([...selection.selected, ...(selection.isOther && selection.other ? [selection.other] : [])])];
}
