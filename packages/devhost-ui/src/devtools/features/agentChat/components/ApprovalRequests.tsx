import { Button } from "@alexgorbatchev/shadcn";
import { SquareIcon } from "lucide-react";
import { Icon } from "../../../../components/ui/Icon";
import type { ReactElement } from "react";
import type { ChatRequestId, IChatEvent, IChatPendingRequest } from "../types";
import { readChatApproval } from "../readChatApproval";
import { readChatQuestions } from "../readChatQuestions";
import { ChatQuestionRequest } from "../questions/components/ChatQuestionRequest";
import { ChatApprovalRequest } from "./ChatApprovalRequest";

interface IApprovalRequestsProps {
  pendingRequests: readonly IChatPendingRequest[];
  events: readonly IChatEvent[];
  respond: (requestId: ChatRequestId, result: unknown) => void;
  interrupt: VoidFunction;
}
export function ApprovalRequests({
  pendingRequests,
  events,
  respond,
  interrupt,
}: IApprovalRequestsProps): ReactElement | null {
  if (!pendingRequests.length) return null;
  return (
    <div data-testid="ApprovalRequests" aria-label="Pending agent requests" className="flex min-w-0 flex-col gap-3">
      {pendingRequests.map((request) => {
        const key = `${typeof request.requestId}:${request.requestId}`;
        const questions = readChatQuestions(request);
        if (questions)
          return (
            <ChatQuestionRequest
              key={key}
              request={request}
              questions={questions}
              respond={respond}
              interrupt={interrupt}
            />
          );
        const approval = readChatApproval(request);
        if (approval)
          return (
            <ChatApprovalRequest
              key={key}
              request={request}
              approval={approval}
              events={events}
              respond={respond}
              interrupt={interrupt}
            />
          );
        return (
          <section
            key={key}
            aria-label="Unsupported agent request"
            className="flex min-w-0 flex-col gap-2 rounded-sm border border-border p-2"
          >
            <p className="text-base font-medium">This native request needs an unsupported interaction.</p>
            <p className="text-xs text-muted-foreground">{request.method}</p>
            <details>
              <summary className="cursor-pointer text-xs">Native request details</summary>
              <pre className="max-h-64 overflow-auto text-xs whitespace-pre-wrap break-words">
                {JSON.stringify(request.payload, null, 2)}
              </pre>
            </details>
            <Button type="button" variant="outline" onClick={interrupt}>
              <Icon glyph={SquareIcon} />
              Stop Turn
            </Button>
          </section>
        );
      })}
    </div>
  );
}
