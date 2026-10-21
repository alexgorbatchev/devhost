import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { Button, NativeSelect, NativeSelectOption } from "@alexgorbatchev/shadcn";
import { lazy, Suspense, useState, type ChangeEvent, type JSX, type ReactNode } from "react";
import { cn } from "../../../../lib/utils";
import type { IAgentChatController } from "../types";
import { ApprovalRequests } from "./ApprovalRequests";
import { AgentChatBody } from "../layouts/AgentChatBody";

const Thread = lazy(() =>
  import("@alexgorbatchev/shadcn/assistant-ui/native/thread").then((module) => ({ default: module.Thread })),
);

type ChatPanelSide = "left" | "right";

interface IAgentChatPanelProps {
  chat: IAgentChatController;
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
}

export function AgentChatPanel({ chat, isOpen, onClose, children }: IAgentChatPanelProps): JSX.Element {
  const [side, setSide] = useState<ChatPanelSide>("right");
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
        "pointer-events-auto fixed top-2 bottom-14 z-(--devhost-z-edge) flex w-[min(448px,calc(100vw-16px))] flex-col overflow-hidden rounded-md border border-edge bg-card text-card-foreground shadow-frame max-sm:top-auto max-sm:h-[65dvh]",
        side === "right" ? "right-2" : "left-2",
        !isOpen && "hidden",
      )}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-border p-2">
        <h2 className="flex-1 font-semibold">Agent chat</h2>
        <Button size="sm" variant="ghost" onClick={() => setSide(side === "right" ? "left" : "right")}>
          Move chat to {side === "right" ? "left" : "right"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Collapse chat
        </Button>
      </header>
      <section aria-label="Chat settings and page context" className="max-h-[45%] shrink-0 overflow-y-auto">
        <div className="grid shrink-0 grid-cols-2 gap-2 border-b border-border p-2">
          <label className="min-w-0">
            Harness
            <NativeSelect
              aria-label="Harness"
              value={chat.selectedHarness}
              disabled={isBusy || chat.isCatalogLoading}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                const chosen = chat.harnesses.find((candidate) => candidate.id === event.currentTarget.value);
                if (chosen) chat.setSelectedHarness(chosen.id);
              }}
            >
              {chat.harnesses.map((candidate) => (
                <NativeSelectOption key={candidate.id} value={candidate.id} disabled={!candidate.available}>
                  {candidate.label}
                  {candidate.available ? "" : " (unavailable)"}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <label className="min-w-0">
            Model
            <NativeSelect
              aria-label="Model"
              value={chat.selectedModel}
              disabled={isBusy || chat.isCatalogLoading || !harness?.available}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => chat.setSelectedModel(event.currentTarget.value)}
            >
              <NativeSelectOption value="">Configured default</NativeSelectOption>
              {harness?.models.map((model) => (
                <NativeSelectOption key={model.id} value={model.id}>
                  {model.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <label className="col-span-2">
            Conversation
            <NativeSelect
              aria-label="Conversation"
              value={chat.session?.id ?? ""}
              disabled={isBusy}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                const session = chat.sessions.find((candidate) => candidate.id === event.currentTarget.value);
                if (session) void chat.resumeSession(session);
                else void chat.newSession();
              }}
            >
              <NativeSelectOption value="">New conversation</NativeSelectOption>
              {chat.sessions.map((session) => (
                <NativeSelectOption key={session.id} value={session.id}>
                  {session.harness} · {session.id}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <Button
            size="sm"
            variant="outline"
            disabled={isBusy}
            onClick={() => {
              void chat.newSession();
            }}
          >
            New conversation
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={chat.isPreparing || chat.isCatalogLoading}
            onClick={() => {
              void chat.refreshCatalog();
            }}
          >
            Refresh harnesses
          </Button>
        </div>
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
            <Thread autoFocus={false} emptyComposerPosition="bottom" components={{ Welcome: ChatWelcome }} />
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
            Close conversation
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
