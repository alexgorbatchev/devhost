import { Button, Collapsible, CollapsibleContent, CollapsibleTrigger } from "@alexgorbatchev/shadcn";
import type { TextMessagePartProps } from "@assistant-ui/react";
import { FileTextIcon } from "lucide-react";
import type { JSX } from "react";
import { Icon } from "../../../../components/ui/Icon";

const contextSeparator = "\n\nPage context (the attached tab snapshot includes the annotations):\n";

export function ChatUserText({ text }: TextMessagePartProps): JSX.Element {
  const index = text.lastIndexOf(contextSeparator);
  if (index < 0)
    return (
      <p data-testid="ChatUserText" className="whitespace-pre-wrap">
        {text}
      </p>
    );
  const context = text.slice(index + contextSeparator.length);
  return (
    <div data-testid="ChatUserText" className="flex flex-col gap-2">
      <p className="whitespace-pre-wrap">{text.slice(0, index)}</p>
      <Collapsible defaultOpen={false}>
        <CollapsibleTrigger
          render={
            <Button size="sm" variant="outline">
              <Icon glyph={FileTextIcon} />
              Page Context
            </Button>
          }
        />
        <CollapsibleContent>
          <pre className="max-h-60 overflow-auto rounded-sm border border-border bg-background p-2 text-foreground whitespace-pre-wrap wrap-anywhere">
            {formatContext(context)}
          </pre>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function formatContext(context: string): string {
  try {
    return JSON.stringify(JSON.parse(context), null, 2);
  } catch {
    return context;
  }
}
