import { Button } from "@alexgorbatchev/shadcn";
import { SquareIcon } from "lucide-react";
import { Icon } from "../../../../components/ui/Icon";
import { ApprovalCard } from "@alexgorbatchev/shadcn/assistant-ui/approval-card";
import { useState, type ReactElement } from "react";
import type { IChatApproval } from "../approvals/types";
import type { ChatRequestId, IChatEvent, IChatPendingRequest } from "../types";
import { readChatRequestChanges } from "../readChatRequestChanges";

interface IChatApprovalRequestProps {
  request: IChatPendingRequest;
  approval: IChatApproval;
  events: readonly IChatEvent[];
  respond: (requestId: ChatRequestId, result: unknown) => void;
  interrupt: VoidFunction;
}
export function ChatApprovalRequest({
  request,
  approval,
  events,
  respond,
  interrupt,
}: IChatApprovalRequestProps): ReactElement {
  const [isSent, setIsSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changes = readChatRequestChanges(request, events);
  const answer = (result: unknown): void => {
    try {
      respond(request.requestId, result);
      setIsSent(true);
      setError(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <section data-testid="ChatApprovalRequest" aria-label={approval.title} className="flex min-w-0 flex-col gap-2">
      <details open>
        <summary className="cursor-pointer text-xs font-medium">Native request details</summary>
        <pre className="max-h-64 overflow-auto rounded-sm border border-border bg-secondary p-2 text-xs whitespace-pre-wrap break-words">
          {JSON.stringify(approval.details, null, 2)}
        </pre>
      </details>
      {changes.map((change) => (
        <figure key={change.path} className="flex min-w-0 flex-col gap-1">
          <figcaption className="text-xs font-medium">{change.path}</figcaption>
          <pre
            aria-label={`Proposed diff for ${change.path}`}
            className="max-h-64 overflow-auto rounded-sm border border-border bg-secondary p-2 text-xs whitespace-pre-wrap"
          >
            {change.diff}
          </pre>
        </figure>
      ))}
      {request.method === "item/fileChange/requestApproval" && !changes.length ? (
        <p className="text-xs text-muted-foreground">The harness has not supplied a file diff for this request.</p>
      ) : null}
      <ApprovalCard
        allowOnceLabel="Allow Once"
        alwaysAllowLabel="Always Allow"
        state={isSent ? "running" : "request"}
        title={approval.title}
        subtitle={request.harness === "codex" ? "Codex" : "Claude Code"}
        description={approval.description}
        onAllowOnce={
          request.method === "item/fileChange/requestApproval" && !changes.length
            ? undefined
            : () => answer(approval.allow)
        }
        onDeny={() => answer(approval.deny)}
        statusLabel={isSent ? "Decision sent; waiting for the harness." : undefined}
      />
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="button" variant="outline" onClick={interrupt}>
        <Icon glyph={SquareIcon} />
        Stop Turn
      </Button>
    </section>
  );
}
