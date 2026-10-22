import { getChatQuestionAnswers } from "../getChatQuestionAnswers";
import { Button } from "@alexgorbatchev/shadcn";
import { CheckIcon, SquareIcon } from "lucide-react";
import { Icon } from "../../../../../components/ui/Icon";
import { useState, type ReactElement } from "react";
import type { ChatRequestId, IChatPendingRequest } from "../../types";
import type { IChatQuestions, IChatQuestionSelection } from "../types";
import { createChatQuestionResponse } from "../../createChatQuestionResponse";
import { ChatQuestionField } from "./ChatQuestionField";

interface IChatQuestionRequestProps {
  request: IChatPendingRequest;
  questions: IChatQuestions;
  respond: (requestId: ChatRequestId, result: unknown) => void;
  interrupt: VoidFunction;
}
export function ChatQuestionRequest({
  request,
  questions,
  respond,
  interrupt,
}: IChatQuestionRequestProps): ReactElement {
  const [answers, setAnswers] = useState<Record<string, IChatQuestionSelection>>({});
  const [isSent, setIsSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isComplete = questions.questions.every((question) =>
    getChatQuestionAnswers(answers[question.id]).some((value) => value.trim()),
  );
  return (
    <form
      data-testid="ChatQuestionRequest"
      aria-label="Agent questions"
      className="flex min-w-0 flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        try {
          respond(
            request.requestId,
            createChatQuestionResponse(
              request,
              Object.fromEntries(
                Object.entries(answers).map(([id, selection]) => [id, getChatQuestionAnswers(selection)]),
              ),
            ),
          );
          setIsSent(true);
          setError(null);
        } catch (error) {
          setError(error instanceof Error ? error.message : String(error));
        }
      }}
    >
      {questions.questions.map((question) => (
        <ChatQuestionField
          key={question.id}
          question={question}
          value={answers[question.id] ?? { selected: [], other: "", isOther: false }}
          disabled={isSent}
          onChange={(answer) => setAnswers((current) => ({ ...current, [question.id]: answer }))}
        />
      ))}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {isSent ? (
        <p role="status" className="text-xs text-muted-foreground">
          Answers sent; waiting for the harness.
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={!isComplete || isSent}>
          <Icon glyph={CheckIcon} />
          Submit Answers
        </Button>
        <Button type="button" variant="outline" onClick={interrupt}>
          <Icon glyph={SquareIcon} />
          Stop Turn
        </Button>
      </div>
    </form>
  );
}
