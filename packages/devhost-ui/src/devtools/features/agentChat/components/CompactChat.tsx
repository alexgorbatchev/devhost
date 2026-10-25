import { Button } from "@alexgorbatchev/shadcn";
import {
  ComposerAddAttachment,
  ComposerAttachments,
} from "@alexgorbatchev/shadcn/assistant-ui/native/attachment-preview";
import { MarkdownText } from "@alexgorbatchev/shadcn/assistant-ui/markdown-text";
import {
  AuiIf,
  ComposerPrimitive,
  MessageByIndexProvider,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
} from "@assistant-ui/react";
import { ArrowUpIcon, LoaderCircleIcon, SquareIcon } from "lucide-react";
import type { JSX, Ref } from "react";
import { Icon } from "../../../../components/ui/Icon";
import { ChatComposerActions } from "./ChatComposerActions";

interface ICompactChatProps {
  isBusy: boolean;
  isAwaitingAction: boolean;
  replyAfterMessageId?: string;
  composerInputRef?: Ref<HTMLTextAreaElement>;
}

export function CompactChat({
  isBusy,
  isAwaitingAction,
  replyAfterMessageId,
  composerInputRef,
}: ICompactChatProps): JSX.Element {
  const replyIndex = useAuiState((state) => {
    const boundary = state.thread.messages.findIndex((message) => message.id === replyAfterMessageId);
    return state.thread.messages.findLastIndex(
      (message, index) =>
        index > boundary &&
        message.role === "assistant" &&
        message.content.some((part) => part.type === "text" && part.text.trim().length > 0),
    );
  });
  return (
    <ThreadPrimitive.Root data-testid="CompactChat" asChild>
      <div className="flex h-full min-h-0 flex-col gap-2 p-2">
        <div
          role="region"
          aria-label="Latest agent response"
          aria-live="polite"
          aria-busy={isBusy}
          className="min-h-0 flex-1 overflow-auto"
        >
          {isBusy ? (
            <p role="status" className="flex items-center gap-2 text-muted-foreground">
              <Icon glyph={LoaderCircleIcon} isSpinning />
              {isAwaitingAction ? "Waiting for your response…" : "Working…"}
            </p>
          ) : replyIndex >= 0 ? (
            <MessageByIndexProvider index={replyIndex}>
              <MessagePrimitive.Root asChild>
                <article>
                  <MessagePrimitive.Parts components={{ Text: MarkdownText }} />
                </article>
              </MessagePrimitive.Root>
            </MessageByIndexProvider>
          ) : (
            <p className="text-muted-foreground">Chat with your configured coding agent.</p>
          )}
        </div>
        <ComposerPrimitive.Root render={<form className="shrink-0" />}>
          <ComposerPrimitive.AttachmentDropzone asChild>
            <div className="flex flex-col gap-1 rounded-sm border border-input bg-background p-1.5">
              <ComposerAttachments />
              <ComposerPrimitive.Input
                ref={composerInputRef}
                rows={1}
                autoFocus={false}
                enterKeyHint="send"
                aria-label="Message input"
                placeholder="Send a message…"
                asChild
              >
                <textarea className="max-h-24 min-h-8 w-full resize-none bg-transparent p-1 text-sm placeholder:text-muted-foreground outline-none" />
              </ComposerPrimitive.Input>
              <div className="flex items-center justify-between gap-1">
                <ComposerAddAttachment />
                <div className="flex items-center gap-1">
                  <ChatComposerActions />
                  <AuiIf condition={(state) => !state.composer.canCancel}>
                    <ComposerPrimitive.Send asChild>
                      <Button size="icon-sm" aria-label="Send Message" title="Send Message">
                        <Icon glyph={ArrowUpIcon} />
                      </Button>
                    </ComposerPrimitive.Send>
                  </AuiIf>
                  <AuiIf condition={(state) => state.composer.canCancel}>
                    <ComposerPrimitive.Cancel asChild>
                      <Button size="icon-sm" aria-label="Stop Generating" title="Stop Generating">
                        <Icon glyph={SquareIcon} />
                      </Button>
                    </ComposerPrimitive.Cancel>
                  </AuiIf>
                </div>
              </div>
            </div>
          </ComposerPrimitive.AttachmentDropzone>
        </ComposerPrimitive.Root>
      </div>
    </ThreadPrimitive.Root>
  );
}
