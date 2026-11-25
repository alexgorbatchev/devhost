import { ConfirmationDialog, DensityProvider } from "@alexgorbatchev/shadcn";
import { TooltipIconButton } from "@alexgorbatchev/shadcn/assistant-ui/tooltip-icon-button";
import { AuiIf, ComposerPrimitive } from "@assistant-ui/react";
import { ArrowUpIcon, SquarePenIcon, Trash2Icon } from "lucide-react";
import { useContext, useState, type JSX } from "react";
import { Icon } from "../../../../components/ui/Icon";
import { AgentChatContext } from "../AgentChatContext";
import { TabShareActions } from "./TabShareActions";

export function ChatComposerActions(): JSX.Element {
  const chat = useContext(AgentChatContext);
  if (!chat) throw new Error("Chat composer actions require an agent chat controller.");
  const [isConfirmingClose, setIsConfirmingClose] = useState(false);
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
          onClick={() => setIsConfirmingClose(true)}
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
      {/* The dialog portals out; hiding the provider's wrapper keeps it out of the row's spacing. */}
      <DensityProvider density="comfortable" hidden>
        <ConfirmationDialog
          open={isConfirmingClose && chat.session !== null}
          title="Close Conversation?"
          description="This ends the agent process. You can resume the conversation from Chat Settings."
          confirmLabel="Close"
          onOpenChange={setIsConfirmingClose}
          onConfirm={() => chat.closeSession()}
        />
      </DensityProvider>
    </div>
  );
}
