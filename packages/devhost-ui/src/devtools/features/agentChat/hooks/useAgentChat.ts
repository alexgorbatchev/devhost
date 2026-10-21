import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  MessageNotSentError,
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import { createAgentChatClient } from "../createAgentChatClient";
import { projectChatEvents } from "../projectChatEvents";
import type { IAgentChatController, IAgentChatOptions } from "../types";

type ChatAction = () => Promise<void>;

export function useAgentChat({ pageURL, beforeSend }: IAgentChatOptions): IAgentChatController {
  const lifetime = useMemo(
    () => ({ client: createAgentChatClient(pageURL, window.location), generation: 0 }),
    [pageURL],
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
      try {
        // Invoke before awaiting anything: a root-owned getDisplayMedia call needs the user's activation.
        const preparation = beforeSend ? beforeSend(text) : {};
        setIsPreparing(true);
        client.setSendError(null);
        const prepared = await preparation;
        if (prepared === null)
          throw new MessageNotSentError("Tab sharing was cancelled. Your draft has been retained.");
        await client.send(prepared, text);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        client.setSendError(message);
        throw new MessageNotSentError(message);
      } finally {
        setIsPreparing(false);
      }
    },
    [beforeSend, client],
  );
  const isRunning = state.session?.status === "running";
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
    isSendDisabled: isPreparing || state.isCatalogLoading || state.session?.status === "requires_action",
    onNew,
    onCancel: async () => {
      interrupt();
    },
  });
  return {
    runtime,
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
