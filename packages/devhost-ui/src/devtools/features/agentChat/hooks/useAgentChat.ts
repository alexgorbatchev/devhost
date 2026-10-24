import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  MessageNotSentError,
  SimpleImageAttachmentAdapter,
  createMessageQueue,
  useExternalStoreRuntime,
  type AppendMessage,
  type AssistantRuntime,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import { createAgentChatClient } from "../createAgentChatClient";
import { projectChatEvents } from "../projectChatEvents";
import type { IAgentChatController, IAgentChatOptions } from "../types";
import { createDevtoolsSettingsStore } from "../../../shared/createDevtoolsSettingsStore";
import { readInjectedDevtoolsConfig } from "../../../shared/readInjectedDevtoolsConfig";

type ChatAction = () => Promise<void>;

export function useAgentChat({
  pageURL,
  target,
  beforeSend,
  onSent,
  settingsStore: providedSettings,
}: IAgentChatOptions): IAgentChatController {
  const settingsStore = useMemo(() => {
    if (providedSettings) return providedSettings;
    const config = readInjectedDevtoolsConfig();
    return createDevtoolsSettingsStore(
      {
        pageURL,
        projectRootPath: target === "devhost" ? config.devhostSourceRootPath : config.projectRootPath,
      },
      () => window.localStorage,
    );
  }, [pageURL, providedSettings, target]);
  const lifetime = useMemo(
    () => ({
      client: createAgentChatClient(pageURL, target, window.location, settingsStore),
      generation: 0,
      composerText: settingsStore.getState().chat.draft,
    }),
    [pageURL, settingsStore, target],
  );
  const client = lifetime.client;
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const [isPreparing, setIsPreparing] = useState(false);
  useEffect(() => {
    const generation = ++lifetime.generation;
    void client.refreshCatalog();
    return () => {
      queueMicrotask(() => {
        if (lifetime.generation === generation) client.dispose();
      });
    };
  }, [client, lifetime]);
  const projection = useMemo(
    () => projectChatEvents(state.session?.harness ?? state.selectedHarness, state.events, state.pendingRequestIds),
    [state.events, state.pendingRequestIds, state.selectedHarness, state.session?.harness],
  );
  const onNew = useCallback(
    async (message: AppendMessage): Promise<void> => {
      const text = message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n");
      // The native composer detaches its text before onNew. Retain it until the server acknowledges the send.
      settingsStore.getState().updateChat({ draft: text });
      try {
        // Invoke before awaiting anything: a root-owned getDisplayMedia call needs the user's activation.
        const preparation = beforeSend ? beforeSend(text) : {};
        setIsPreparing(true);
        client.setSendError(null);
        const prepared = await preparation;
        if (prepared === null)
          throw new MessageNotSentError("Tab sharing was cancelled. Your draft has been retained.");
        const images = [
          ...(prepared.images ?? []),
          ...message.content.filter((part) => part.type === "image").map((part) => ({ dataURL: part.image })),
          ...(message.attachments ?? []).flatMap((attachment) =>
            attachment.content.filter((part) => part.type === "image").map((part) => ({ dataURL: part.image })),
          ),
        ];
        await client.send({ ...prepared, images }, text);
        settingsStore.getState().updateChat({ draft: lifetime.composerText });
        onSent?.();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        client.setSendError(message);
        throw new MessageNotSentError(message);
      } finally {
        setIsPreparing(false);
      }
    },
    [beforeSend, client, lifetime, onSent, settingsStore],
  );
  const isRunning = state.session?.status === "running" || state.session?.status === "requires_action";
  const sendReference = useRef(onNew);
  const runtimeReference = useRef<AssistantRuntime | null>(null);
  useLayoutEffect(() => {
    sendReference.current = onNew;
  }, [onNew]);
  // This queue waits for delivery acknowledgement, not for the agent's turn to finish.
  // Native harnesses own when accepted follow-ups enter their active work.
  const sessionID = state.session?.id;
  const queue = useMemo(() => {
    const controller = createMessageQueue({
      run: async (message) => {
        controller.notifyBusy();
        try {
          await sendReference.current(message);
        } catch {
          // The shared Thread does not render queued input. Restore failed
          // follow-ups to its native composer so text and images remain editable.
          if (client.getSnapshot().session?.id === sessionID) {
            controller.notifyCancelled();
            const composer = runtimeReference.current?.thread.composer;
            if (composer) {
              const text = message.content
                .filter((part) => part.type === "text")
                .map((part) => part.text)
                .join("\n");
              composer.setText([text, composer.getState().text].filter(Boolean).join("\n"));
              for (const attachment of message.attachments ?? []) await composer.addAttachment(attachment);
            }
          }
        } finally {
          controller.notifyIdle();
        }
      },
    });
    return controller;
  }, [client, sessionID]);
  const readQueue = useCallback(() => queue.adapter.items, [queue]);
  const readSteerQueue = useCallback(() => queue.adapter.steerItems, [queue]);
  useSyncExternalStore(queue.subscribe, readQueue);
  useSyncExternalStore(queue.subscribe, readSteerQueue);
  useEffect(() => () => queue.clear(), [queue]);
  const attachments = useMemo(() => {
    const adapter = new SimpleImageAttachmentAdapter();
    adapter.accept = "image/png,image/jpeg";
    return adapter;
  }, []);
  const reportAction = useCallback(
    async (action: ChatAction): Promise<void> => {
      try {
        await action();
      } catch (error) {
        client.setSendError(error instanceof Error ? error.message : String(error));
      }
    },
    [client],
  );
  const interrupt = useCallback((): void => {
    try {
      client.interrupt();
    } catch (error) {
      client.setSendError(error instanceof Error ? error.message : String(error));
    }
  }, [client]);
  const runtime = useExternalStoreRuntime<ThreadMessageLike>({
    messages: projection.messages,
    convertMessage: (message) => message,
    isRunning,
    isLoading: state.isConnecting,
    isSendDisabled: isPreparing || state.isCatalogLoading,
    adapters: { attachments },
    queue:
      isRunning || queue.adapter.items.length > 0 || queue.adapter.steerItems.length > 0 ? queue.adapter : undefined,
    onNew,
    onCancel: async () => {
      interrupt();
    },
  });
  useLayoutEffect(() => {
    runtimeReference.current = runtime;
  }, [runtime]);
  // The native runtime applies the adapter in an effect, after the server snapshot has reached this hook.
  // Wait for that runtime's history before allowing the viewport to restore or record a position.
  const subscribeToHistory = useCallback((listener: VoidFunction) => runtime.thread.subscribe(listener), [runtime]);
  const readIsHistoryReady = useCallback((): boolean => {
    const thread = runtime.thread.getState();
    return (
      !thread.isLoading &&
      thread.messages.length === projection.messages.length &&
      thread.messages.every((message, index) => message.id === projection.messages[index]?.id)
    );
  }, [projection.messages, runtime]);
  const isHistoryReady = useSyncExternalStore(subscribeToHistory, readIsHistoryReady);
  useEffect(() => {
    const composer = runtime.thread.composer;
    composer.setText(settingsStore.getState().chat.draft);
    lifetime.composerText = composer.getState().text;
    return composer.subscribe(() => {
      const text = composer.getState().text;
      if (text === lifetime.composerText) return;
      lifetime.composerText = text;
      settingsStore.getState().updateChat({ draft: text });
    });
  }, [lifetime, runtime, settingsStore]);
  return {
    settingsStore,
    runtime,
    isHistoryReady,
    isPreparing,
    harnesses: state.harnesses,
    isCatalogLoading: state.isCatalogLoading,
    catalogError: state.catalogError,
    selectedHarness: state.selectedHarness,
    setSelectedHarness: client.setSelectedHarness,
    selectedModel: state.selectedModel,
    setSelectedModel: client.setSelectedModel,
    sessions: state.sessions,
    session: state.session,
    isConnecting: state.isConnecting,
    isConnected: state.isConnected,
    sendError: state.sendError,
    pendingRequests: projection.pendingRequests,
    events: projection.events,
    refreshCatalog: client.refreshCatalog,
    newSession: () => reportAction(client.newSession),
    resumeSession: (session) => reportAction(() => client.resumeSession(session)),
    closeSession: () => reportAction(client.closeSession),
    interrupt,
    respond: client.respond,
  };
}
