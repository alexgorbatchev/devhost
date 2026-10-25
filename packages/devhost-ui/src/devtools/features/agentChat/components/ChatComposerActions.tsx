import { Button } from "@alexgorbatchev/shadcn";
import { AuiIf, ComposerPrimitive } from "@assistant-ui/react";
import { ArrowUpIcon, PlusIcon } from "lucide-react";
import { useContext, type JSX } from "react";
import { Icon } from "../../../../components/ui/Icon";
import { AgentChatContext } from "../AgentChatContext";
import { TabShareActions } from "./TabShareActions";

export function ChatComposerActions(): JSX.Element {
  const chat = useContext(AgentChatContext);
  if (!chat) throw new Error("Chat composer actions require an agent chat controller.");
  const isBusy =
    chat.isAwaitingReply ||
    chat.isPreparing ||
    chat.isConnecting ||
    chat.isCatalogLoading ||
    chat.session?.status === "running" ||
    chat.session?.status === "requires_action";
  return (
    <div
      data-testid="ChatComposerActions"
      role="group"
      aria-label="Conversation actions"
      className="flex items-center gap-1.5"
    >
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="New Conversation"
        title="New Conversation"
        disabled={isBusy}
        onClick={() => {
          void chat.newSession();
        }}
      >
        <Icon glyph={PlusIcon} />
      </Button>
      <TabShareActions />
      <AuiIf condition={(state) => state.thread.isRunning && state.composer.canCancel}>
        <ComposerPrimitive.Send asChild>
          <Button size="icon-sm" aria-label="Send Message" title="Send Message">
            <Icon glyph={ArrowUpIcon} />
          </Button>
        </ComposerPrimitive.Send>
      </AuiIf>
    </div>
  );
}
