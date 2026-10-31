import {
  Button,
  DensityProvider,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Field,
  FieldGroup,
  FieldLabel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alexgorbatchev/shadcn";
import { RefreshCwIcon, SettingsIcon } from "lucide-react";
import { useId, type JSX } from "react";
import { Icon } from "../../../../components/ui/Icon";
import { formatChatSessionLabel } from "../formatChatSessionLabel";
import type { IAgentChatController, IChatSession } from "../types";

interface IChatSettingsProps {
  chat: IAgentChatController;
  isBusy: boolean;
}

interface IChatSettingItem {
  value: string | null;
  label: string;
  isDisabled?: boolean;
}

export function ChatSettings({ chat, isBusy }: IChatSettingsProps): JSX.Element {
  const harnessId = useId();
  const modelId = useId();
  const conversationId = useId();
  const harness = chat.harnesses.find((candidate) => candidate.id === chat.selectedHarness);
  const harnessItems: IChatSettingItem[] = chat.harnesses.map((candidate) => ({
    value: candidate.id,
    label: candidate.available ? candidate.label : `${candidate.label} (unavailable)`,
    isDisabled: !candidate.available,
  }));
  // A null value is the native default: the harness picks its configured model.
  const modelItems: IChatSettingItem[] = [
    { value: null, label: "Configured default" },
    ...(harness?.models.map((model) => ({ value: model.id, label: model.label })) ?? []),
  ];
  const conversationItems: IChatSettingItem[] = [
    { value: null, label: "New conversation" },
    ...chat.sessions.map((session) => ({ value: session.id, label: formatConversationLabel(session) })),
  ];
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
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={harnessId}>Harness</FieldLabel>
              <Select
                items={harnessItems}
                value={chat.selectedHarness}
                disabled={isBusy || chat.isCatalogLoading}
                onValueChange={(value) => {
                  const chosen = chat.harnesses.find((candidate) => candidate.id === value);
                  if (chosen) chat.setSelectedHarness(chosen.id);
                }}
              >
                <SelectTrigger id={harnessId}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {harnessItems.map((item) => (
                    <SelectItem key={item.value} value={item.value} disabled={item.isDisabled}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor={modelId}>Model</FieldLabel>
              <Select
                items={modelItems}
                value={chat.selectedModel || null}
                disabled={isBusy || chat.isCatalogLoading || !harness?.available}
                onValueChange={(value) => chat.setSelectedModel(value ?? "")}
              >
                <SelectTrigger id={modelId}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {modelItems.map((item) => (
                    <SelectItem key={item.value ?? ""} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor={conversationId}>Conversation</FieldLabel>
              <Select
                items={conversationItems}
                value={chat.session?.id ?? null}
                disabled={isBusy}
                onValueChange={(value) => {
                  const session = chat.sessions.find((candidate) => candidate.id === value);
                  if (session) void chat.resumeSession(session);
                  else void chat.newSession();
                }}
              >
                <SelectTrigger id={conversationId}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {conversationItems.map((item) => (
                    <SelectItem key={item.value ?? ""} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
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
          </FieldGroup>
        </DensityProvider>
      </DialogContent>
    </Dialog>
  );
}

// A closed conversation stays listed: choosing it resumes the native session in a new process.
function formatConversationLabel(session: IChatSession): string {
  const label = formatChatSessionLabel(session);
  return session.status === "closed" ? `${label} · closed` : label;
}
