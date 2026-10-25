import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { Button } from "@alexgorbatchev/shadcn";
import { lazy, Suspense, useState, type JSX, type ReactNode, type Ref } from "react";
import { useStore } from "zustand";
import { cn } from "../../../../lib/utils";
import type { IAgentChatController } from "../types";
import { ApprovalRequests } from "./ApprovalRequests";
import { ArrowLeftRightIcon, ChevronDownIcon, Maximize2Icon, Minimize2Icon, XIcon } from "lucide-react";
import { Icon } from "../../../../components/ui/Icon";
import { ChatSettings } from "./ChatSettings";
import { ChatUserText } from "./ChatUserText";
import { ChatComposerActions } from "./ChatComposerActions";
import { AgentChatContext } from "../AgentChatContext";
import { TabShareContext, type IChatTabShare } from "../TabShareContext";
import { AgentChatBody } from "../layouts/AgentChatBody";
import { useChatScrollPosition } from "../hooks/useChatScrollPosition";

const Thread = lazy(() =>
  import("@alexgorbatchev/shadcn/assistant-ui/native/thread").then((module) => ({ default: module.Thread })),
);
const CompactChat = lazy(() => import("./CompactChat").then((module) => ({ default: module.CompactChat })));

interface IAgentChatPanelProps {
  chat: IAgentChatController;
  composerInputRef?: Ref<HTMLTextAreaElement>;
  headerControls?: ReactNode;
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  sharing?: IChatTabShare;
}

export function AgentChatPanel({
  chat,
  composerInputRef,
  headerControls,
  isOpen,
  onClose,
  children,
  sharing,
}: IAgentChatPanelProps): JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false);
  const side = useStore(chat.settingsStore, (state) => state.chat.side);
  const viewportProps = useChatScrollPosition({
    settingsStore: chat.settingsStore,
    isOpen: isOpen && isExpanded,
    isReady: chat.isHistoryReady && !chat.isCatalogLoading && !chat.isConnecting,
    sessionId: chat.session?.id,
  });
  const harness = chat.harnesses.find((candidate) => candidate.id === chat.selectedHarness);
  const isBusy =
    chat.isAwaitingReply ||
    chat.isPreparing ||
    chat.isConnecting ||
    chat.session?.status === "running" ||
    chat.session?.status === "requires_action";
  return (
    <aside
      data-testid="AgentChatPanel"
      hidden={!isOpen}
      aria-label="Agent chat"
      data-devhost-capture-exclude=""
      className={cn(
        "pointer-events-auto fixed bottom-14 z-(--devhost-z-edge) flex w-[min(448px,calc(100vw-16px))] flex-col overflow-hidden rounded-md border border-edge bg-card text-card-foreground shadow-frame",
        isExpanded
          ? "top-20 max-sm:top-auto max-sm:h-[65dvh]"
          : "h-[clamp(260px,calc((100dvh-136px)/3),360px)] max-h-[calc(100dvh-136px)]",
        side === "right" ? "right-2" : "left-2",
        !isOpen && "hidden",
      )}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-border p-2">
        <h2 className="flex-1 font-semibold">Agent Chat</h2>
        {headerControls}
        <ChatSettings chat={chat} isBusy={isBusy} />
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={isExpanded ? "Compact Chat" : "Expand Chat"}
          title={isExpanded ? "Compact Chat" : "Expand Chat"}
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <Icon glyph={isExpanded ? Minimize2Icon : Maximize2Icon} />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={side === "right" ? "Move Chat To Left" : "Move Chat To Right"}
          title="Move Chat"
          onClick={() => chat.settingsStore.getState().updateChat({ side: side === "right" ? "left" : "right" })}
        >
          <Icon glyph={ArrowLeftRightIcon} />
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label="Collapse Chat" title="Collapse Chat" onClick={onClose}>
          <Icon glyph={ChevronDownIcon} />
        </Button>
      </header>
      <section aria-label="Chat settings and page context" className="max-h-[45%] shrink-0 overflow-y-auto">
        {chat.isCatalogLoading ? (
          <p role="status" className="p-2">
            Discovering configured harnesses…
          </p>
        ) : null}
        {chat.catalogError ? (
          <p role="alert" className="p-2 text-destructive">
            {chat.catalogError}
          </p>
        ) : null}
        {harness?.error ? (
          <p role="status" className="p-2 text-muted-foreground">
            {harness.error}
          </p>
        ) : null}
        {chat.sendError ? (
          <p role="alert" className="p-2 text-destructive">
            {chat.sendError}
          </p>
        ) : null}
        {children}
        {sharing?.error ? (
          <p role="alert" className="p-2 text-destructive">
            {sharing.error}
          </p>
        ) : null}
      </section>
      <AssistantRuntimeProvider runtime={chat.runtime}>
        <AgentChatBody
          requests={
            <ApprovalRequests
              pendingRequests={chat.pendingRequests}
              events={chat.events}
              respond={chat.respond}
              interrupt={chat.interrupt}
            />
          }
        >
          <Suspense fallback={<p role="status">Loading conversation…</p>}>
            <TabShareContext value={sharing}>
              <AgentChatContext value={chat}>
                {isExpanded ? (
                  <Thread
                    viewportProps={viewportProps}
                    composerInputRef={composerInputRef}
                    autoFocus={false}
                    emptyComposerPosition="bottom"
                    components={{ Welcome: ChatWelcome, UserText: ChatUserText, ComposerActions: ChatComposerActions }}
                  />
                ) : (
                  <CompactChat
                    isBusy={isBusy}
                    isAwaitingAction={chat.session?.status === "requires_action"}
                    replyAfterMessageId={chat.replyAfterMessageId}
                    composerInputRef={composerInputRef}
                  />
                )}
              </AgentChatContext>
            </TabShareContext>
          </Suspense>
        </AgentChatBody>
      </AssistantRuntimeProvider>
      <footer className="flex shrink-0 items-center justify-between border-t border-border px-2 py-1 text-muted-foreground">
        <span role="status">
          {chat.session
            ? `${chat.session.harness} · ${chat.session.status}${chat.isConnected ? "" : " · reconnecting"}`
            : "Uses your configured CLI account"}
        </span>
        {chat.session ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={chat.isPreparing}
            onClick={() => {
              void chat.closeSession();
            }}
          >
            <Icon glyph={XIcon} />
            Close Conversation
          </Button>
        ) : null}
      </footer>
    </aside>
  );
}

function ChatWelcome(): JSX.Element {
  return (
    <div className="p-4 text-muted-foreground">
      <p>Chat with your configured coding agent.</p>
      <p>Select page elements or draw annotations to include context. Share Tab optionally adds a snapshot.</p>
    </div>
  );
}
