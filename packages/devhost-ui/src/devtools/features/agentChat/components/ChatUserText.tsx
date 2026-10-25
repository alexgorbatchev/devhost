import { Button, Collapsible, CollapsibleContent, CollapsibleTrigger } from "@alexgorbatchev/shadcn";
import type { TextMessagePartProps } from "@assistant-ui/react";
import { FileTextIcon } from "lucide-react";
import type { JSX } from "react";
import { Icon } from "../../../../components/ui/Icon";

const contextSeparator = "\n\nPage context:\n";
const workflowSeparator = "\n\nDevhost workflow instructions:\n";

export function ChatUserText({ text }: TextMessagePartProps): JSX.Element {
  const workflowIndex = text.lastIndexOf(workflowSeparator);
  const userText = workflowIndex < 0 ? text : text.slice(0, workflowIndex);
  const index = userText.lastIndexOf(contextSeparator);
  if (index < 0 && workflowIndex < 0)
    return (
      <p data-testid="ChatUserText" className="whitespace-pre-wrap">
        {text}
      </p>
    );
  return (
    <div data-testid="ChatUserText" className="flex flex-col gap-2">
      <p className="whitespace-pre-wrap">{index < 0 ? userText : userText.slice(0, index)}</p>
      {index < 0 ? null : (
        <ChatContextDetails
          title="Page Context"
          text={formatContext(userText.slice(index + contextSeparator.length))}
        />
      )}
      {workflowIndex < 0 ? null : (
        <ChatContextDetails title="Workflow Instructions" text={text.slice(workflowIndex + workflowSeparator.length)} />
      )}
    </div>
  );
}

interface IChatContextDetailsProps {
  title: string;
  text: string;
}

function ChatContextDetails({ title, text }: IChatContextDetailsProps): JSX.Element {
  return (
    <Collapsible defaultOpen={false}>
      <CollapsibleTrigger
        render={
          <Button size="sm" variant="outline">
            <Icon glyph={FileTextIcon} />
            {title}
          </Button>
        }
      />
      <CollapsibleContent>
        <pre className="max-h-60 overflow-auto rounded-sm border border-border bg-background p-2 text-foreground whitespace-pre-wrap wrap-anywhere">
          {text}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

function formatContext(context: string): string {
  try {
    return JSON.stringify(JSON.parse(context), null, 2);
  } catch {
    return context;
  }
}
