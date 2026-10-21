export interface IChatQuestionOption {
  label: string;
  description: string;
  preview?: string;
}
export interface IChatQuestion {
  id: string;
  header: string;
  prompt: string;
  options: readonly IChatQuestionOption[];
  isMultiple: boolean;
  isSecret: boolean;
  allowsOther: boolean;
}
export interface IChatQuestions {
  questions: readonly IChatQuestion[];
  input: Record<string, unknown>;
}
export type ChatQuestionAnswers = Readonly<Record<string, readonly string[]>>;
export interface IChatQuestionSelection {
  selected: readonly string[];
  other: string;
  isOther: boolean;
}
