import {
  Button,
  DensityProvider,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  NativeSelect,
  NativeSelectOption,
} from "@alexgorbatchev/shadcn";
import { PlusIcon, RefreshCwIcon, SettingsIcon } from "lucide-react";
import type { ChangeEvent, JSX } from "react";
import { Icon } from "../../../../components/ui/Icon";
import type { IAgentChatController } from "../types";

interface IChatSettingsProps {
  chat: IAgentChatController;
  isBusy: boolean;
}
export function ChatSettings({ chat, isBusy }: IChatSettingsProps): JSX.Element {
  const harness = chat.harnesses.find((candidate) => candidate.id === chat.selectedHarness);
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button size="icon-sm" variant="ghost" aria-label="Chat Settings" title="Chat Settings">
            <Icon glyph={SettingsIcon} />
          </Button>
        }
      />
      <DialogContent>
        <DensityProvider density="comfortable">
          <DialogHeader>
            <DialogTitle>Chat Settings</DialogTitle>
            <DialogDescription>Choose Your Harness, Model, And Conversation.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <label className="min-w-0">
              Harness
              <NativeSelect
                density="comfortable"
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
                density="comfortable"
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
                density="comfortable"
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
              <Icon glyph={PlusIcon} />
              New Conversation
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={chat.isPreparing || chat.isCatalogLoading}
              onClick={() => {
                void chat.refreshCatalog();
              }}
            >
              <Icon glyph={RefreshCwIcon} />
              Refresh Harnesses
            </Button>
          </div>
        </DensityProvider>
      </DialogContent>
    </Dialog>
  );
}
