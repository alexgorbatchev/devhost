import { pristineFetch } from "../../shared/pristineFetch";
import { createDevtoolsWebSocketUrl } from "../../shared/createDevtoolsWebSocketUrl";
import { openReconnectingWebSocket, type IReconnectingWebSocket } from "../../shared/openReconnectingWebSocket";
import type { ILocationHostProtocol } from "../../shared/types";
import { readChatHarnesses, readChatServerFrame, readChatSession, readChatSessions } from "./readChatServerFrame";
import { encodeChatCommand } from "./encodeChatCommand";
import type { ChatCommand, IAgentChatClient, IAgentChatClientState, IChatSession, IChatSessionRequest } from "./types";

interface IPendingChatSend {
  resolve: VoidFunction;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export function createAgentChatClient(pageURL: string, location: ILocationHostProtocol): IAgentChatClient {
  const lifetime = new AbortController();
  const listeners = new Set<VoidFunction>();
  const pendingSends = new Map<string, IPendingChatSend>();
  let stream: IReconnectingWebSocket | null = null;
  let generation = 0;
  let sessionTask: Promise<void> | null = null;
  let cancelConnection: VoidFunction | null = null;
  let state: IAgentChatClientState = {
    harnesses: [],
    sessions: [],
    session: null,
    selectedHarness: "codex",
    selectedModel: "",
    isCatalogLoading: false,
    catalogError: null,
    isConnecting: false,
    isConnected: false,
    sendError: null,
    events: [],
    pendingRequestIds: [],
  };
  const publish = (patch: Partial<IAgentChatClientState>): void => {
    if (lifetime.signal.aborted) return;
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));
  const settleSend = (commandId: string, error?: string): void => {
    const pending = pendingSends.get(commandId);
    if (!pending) return;
    pendingSends.delete(commandId);
    clearTimeout(pending.timeout);
    if (error !== undefined) pending.reject(new Error(error));
    else pending.resolve();
  };
  const rejectPendingSends = (message: string): void => {
    for (const commandId of pendingSends.keys()) settleSend(commandId, message);
  };
  const request = async (path: string, init?: RequestInit): Promise<unknown> => {
    const response = await pristineFetch(path, { ...init, signal: lifetime.signal });
    if (!response.ok) throw new Error((await response.text()) || `Chat request failed (${response.status})`);
    return response.status === 204 ? undefined : response.json();
  };
  const detach = (): void => {
    rejectPendingSends(
      "The chat connection was replaced before confirming your message. Check the conversation before retrying.",
    );
    generation += 1;
    stream?.close();
    stream = null;
    cancelConnection?.();
    cancelConnection = null;
  };
  const attach = (session: IChatSession): Promise<void> => {
    detach();
    const ownGeneration = generation;
    publish({ session, events: [], pendingRequestIds: [], isConnecting: true, isConnected: false, sendError: null });
    return new Promise<void>((resolve, reject) => {
      cancelConnection = () => reject(new Error("The chat connection was replaced."));
      const query = new URLSearchParams({ sessionId: session.id, pageURL });
      stream = openReconnectingWebSocket(createDevtoolsWebSocketUrl(`/__devhost__/ws/chat?${query}`, location), {
        onMessage(event): void {
          if (ownGeneration !== generation) return;
          try {
            if (typeof event.data !== "string") throw new Error("The chat server sent a non-text frame.");
            const value: unknown = JSON.parse(event.data);
            const frame = readChatServerFrame(value);
            if (frame.sessionId && frame.sessionId !== session.id) return;
            if (frame.type === "command_result") {
              settleSend(frame.commandId, frame.error);
              return;
            }
            if (frame.type === "error") {
              rejectPendingSends(frame.error);
              publish({ sendError: frame.error, isConnecting: false });
              reject(new Error(frame.error));
              return;
            }
            if (frame.type === "snapshot") {
              publish({
                session: frame.session,
                events: frame.events ?? [],
                pendingRequestIds: frame.pendingRequestIds,
                isConnecting: false,
                isConnected: true,
              });
              cancelConnection = null;
              resolve();
            } else if (frame.type === "event") {
              publish({
                events: [
                  ...state.events.filter((item) => item.sequence !== frame.sequence),
                  { sequence: frame.sequence, payload: frame.payload },
                ],
              });
            } else publish({ session: frame.session, pendingRequestIds: frame.pendingRequestIds });
          } catch (error) {
            rejectPendingSends(errorText(error));
            publish({ sendError: errorText(error), isConnecting: false });
            reject(error);
          }
        },
        onDisconnect: () => {
          rejectPendingSends("Connection lost before confirming your message. Check the conversation before retrying.");
          publish({ isConnected: false, isConnecting: true });
        },
        onEnd: () => {
          rejectPendingSends("The chat connection closed before confirming your message.");
          publish({ isConnected: false, isConnecting: false });
          reject(new Error("The chat connection closed."));
        },
      });
    });
  };
  const newSession = (resume?: IChatSession): Promise<void> => {
    if (sessionTask) return sessionTask;
    if (resume && !resume.nativeSessionId)
      return Promise.reject(new Error("This closed session has no native session ID to resume."));
    publish({ isConnecting: true, sendError: null });
    const harness = resume?.harness ?? state.selectedHarness;
    const model = harness === state.selectedHarness ? state.selectedModel : "";
    publish({ selectedHarness: harness, selectedModel: model });
    sessionTask = (async (): Promise<void> => {
      const sessionRequest: IChatSessionRequest = {
        harness,
        pageURL,
        ...(model ? { model } : {}),
        ...(resume ? { resumeId: resume.nativeSessionId } : {}),
      };
      const session = readChatSession(
        await request("/__devhost__/chat/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sessionRequest),
        }),
      );
      publish({ sessions: [...state.sessions.filter((item) => item.id !== session.id), session] });
      await attach(session);
    })()
      .catch((error: unknown): never => {
        publish({ isConnecting: false, sendError: errorText(error) });
        throw error;
      })
      .finally(() => {
        sessionTask = null;
      });
    return sessionTask;
  };
  const sendCommand = (command: ChatCommand): void => {
    if (!state.isConnected || !stream?.send(encodeChatCommand(command)))
      throw new Error("The chat session is disconnected. Reconnect before sending.");
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async refreshCatalog(): Promise<void> {
      publish({ isCatalogLoading: true, catalogError: null });
      try {
        const query = new URLSearchParams({ pageURL });
        const [catalog, sessions] = await Promise.all([
          request(`/__devhost__/chat/harnesses?${query}`),
          request(`/__devhost__/chat/sessions?${query}`),
        ]);
        const harnesses = readChatHarnesses(catalog);
        const selected =
          harnesses.find((item) => item.id === state.selectedHarness && item.available) ??
          harnesses.find((item) => item.available);
        publish({
          harnesses,
          sessions: readChatSessions(sessions),
          selectedHarness: selected?.id ?? state.selectedHarness,
          isCatalogLoading: false,
        });
      } catch (error) {
        publish({ isCatalogLoading: false, catalogError: errorText(error) });
      }
    },
    setSelectedHarness(harness): void {
      publish({ selectedHarness: harness, selectedModel: "" });
    },
    setSelectedModel(model): void {
      publish({ selectedModel: model });
    },
    newSession,
    resumeSession(session): Promise<void> {
      if (session.status === "closed") return newSession(session);
      publish({
        selectedHarness: session.harness,
        selectedModel: state.selectedHarness === session.harness ? state.selectedModel : "",
      });
      return attach(session);
    },
    async closeSession(): Promise<void> {
      const session = state.session;
      if (!session) return;
      await request(
        `/__devhost__/chat/sessions/${encodeURIComponent(session.id)}?${new URLSearchParams({ pageURL })}`,
        { method: "DELETE" },
      );
      detach();
      publish({
        session: null,
        sessions: state.sessions.filter((item) => item.id !== session.id),
        events: [],
        pendingRequestIds: [],
        isConnected: false,
        isConnecting: false,
      });
    },
    async send(prepared, originalText): Promise<void> {
      const commandId = crypto.randomUUID();
      const payload = encodeChatCommand({
        type: "send",
        commandId,
        text: prepared.text ?? originalText,
        model: state.selectedModel,
        ...(prepared.images?.length ? { images: prepared.images } : {}),
      });
      if (!state.session || state.session.harness !== state.selectedHarness) await newSession();
      else if (sessionTask) await sessionTask;
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          settleSend(commandId, "Your message was not confirmed. Check the conversation before retrying.");
        }, 45_000);
        pendingSends.set(commandId, { resolve, reject, timeout });
        if (!state.isConnected || !stream?.send(payload)) {
          settleSend(commandId, "The chat session is disconnected. Reconnect before sending.");
        }
      });
    },
    interrupt: () => sendCommand({ type: "interrupt" }),
    respond(requestId, result): void {
      if (!state.pendingRequestIds.includes(requestId)) throw new Error("This native request is no longer pending.");
      sendCommand({ type: "respond", requestId, result });
    },
    setSendError: (sendError) => publish({ sendError }),
    dispose(): void {
      lifetime.abort();
      detach();
      listeners.clear();
    },
  };
}
