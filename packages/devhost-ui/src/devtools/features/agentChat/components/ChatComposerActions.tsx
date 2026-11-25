import { TooltipIconButton } from "@alexgorbatchev/shadcn/assistant-ui/tooltip-icon-button";
import { AuiIf, ComposerPrimitive } from "@assistant-ui/react";
import { ArrowUpIcon, SquarePenIcon, Trash2Icon } from "lucide-react";
import { useContext, type JSX } from "react";
import { Icon } from "../../../../components/ui/Icon";
import { AgentChatContext } from "../AgentChatContext";
import { TabShareActions } from "./TabShareActions";

export function ChatComposerActions(): JSX.Element {
  const chat = useContext(AgentChatContext);
  if (!chat) throw new Error("Chat composer actions require an agent chat controller.");
  const isNewDisabled = chat.isPreparing || chat.isConnecting || chat.isCatalogLoading;
  return (
    <div
      data-testid="ChatComposerActions"
      role="group"
      aria-label="Conversation actions"
      className="flex items-center gap-1.5"
    >
      {chat.session ? (
        <TooltipIconButton
          tooltip="Close Conversation"
          side="top"
          variant="ghost"
          disabled={chat.isPreparing}
          onClick={() => {
            void chat.closeSession();
          }}
        >
          <Icon glyph={Trash2Icon} />
        </TooltipIconButton>
      ) : null}
      <TooltipIconButton
        tooltip="New Conversation"
        side="top"
        variant="ghost"
        disabled={isNewDisabled}
        onClick={() => {
          void chat.newSession();
        }}
      >
        <Icon glyph={SquarePenIcon} />
      </TooltipIconButton>
      <TabShareActions />
      <AuiIf condition={(state) => state.thread.isRunning && state.composer.canCancel}>
        <ComposerPrimitive.Send asChild>
          <TooltipIconButton tooltip="Send Message" side="top" variant="default">
            <Icon glyph={ArrowUpIcon} />
          </TooltipIconButton>
        </ComposerPrimitive.Send>
      </AuiIf>
    </div>
  );
}
