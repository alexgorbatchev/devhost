import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { Button } from "@alexgorbatchev/shadcn";
import { lazy, Suspense, type JSX, type ReactNode, type Ref } from "react";
import { useStore } from "zustand";
import { cn } from "../../../../lib/utils";
import type { IAgentChatController } from "../types";
import { ApprovalRequests } from "./ApprovalRequests";
import { ArrowLeftRightIcon, ChevronDownIcon, XIcon } from "lucide-react";
import { Icon } from "../../../../components/ui/Icon";
import { ChatSettings } from "./ChatSettings";
import { ChatUserText } from "./ChatUserText";
import { ChatComposerActions } from "./ChatComposerActions";
import { AgentChatContext } from "../AgentChatContext";
import { TabShareContext } from "../TabShareContext";
import type { useTabShare } from "../../visualAnnotations/hooks/useTabShare";
import { AgentChatBody } from "../layouts/AgentChatBody";
import { useChatScrollPosition } from "../hooks/useChatScrollPosition";

const Thread = lazy(() =>
  import("@alexgorbatchev/shadcn/assistant-ui/native/thread").then((module) => ({ default: module.Thread })),
);

interface IAgentChatPanelProps {
  chat: IAgentChatController;
  composerInputRef?: Ref<HTMLTextAreaElement>;
  headerControls?: ReactNode;
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  sharing?: ReturnType<typeof useTabShare>;
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
  const side = useStore(chat.settingsStore, (state) => state.chat.side);
  const viewportProps = useChatScrollPosition({
    settingsStore: chat.settingsStore,
    isOpen,
    isReady: chat.isHistoryReady && !chat.isCatalogLoading && !chat.isConnecting,
    sessionId: chat.session?.id,
  });
  const harness = chat.harnesses.find((candidate) => candidate.id === chat.selectedHarness);
  const isBusy =
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
        "pointer-events-auto fixed top-20 bottom-14 z-(--devhost-z-edge) flex w-[min(448px,calc(100vw-16px))] flex-col overflow-hidden rounded-md border border-edge bg-card text-card-foreground shadow-frame max-sm:top-auto max-sm:h-[65dvh]",
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
                <Thread
                  viewportProps={viewportProps}
                  composerInputRef={composerInputRef}
                  autoFocus={false}
                  emptyComposerPosition="bottom"
                  components={{ Welcome: ChatWelcome, UserText: ChatUserText, ComposerActions: ChatComposerActions }}
                />
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
      <p>
        Select page elements or draw annotations to include context. Sending page context asks you to share this tab for
        a snapshot.
      </p>
    </div>
  );
}
