import { pristineFetch } from "../../shared/pristineFetch";
import { createDevtoolsWebSocketUrl } from "../../shared/createDevtoolsWebSocketUrl";
import { openReconnectingWebSocket, type IReconnectingWebSocket } from "../../shared/openReconnectingWebSocket";
import type { ChatTarget, DevtoolsSettingsStore, ILocationHostProtocol } from "../../shared/types";
import { readChatHarnesses, readChatServerFrame, readChatSession, readChatSessions } from "./readChatServerFrame";
import { readRunningAgents } from "../../shared/readRunningAgents";
import { encodeChatCommand } from "./encodeChatCommand";
import type {
  ChatCommand,
  ChatDecision,
  ChatDecisionAnswer,
  ChatDecisionHandler,
  ChatSentState,
  ChatSessionStatus,
  IAgentChatClient,
  IAgentChatClientState,
  IChatReceipt,
  IChatSession,
  IChatSessionRequest,
} from "./types";

interface IPendingChatSend {
  resolve: (state: ChatSentState) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}
const SEND_CONFIRMATION_TIMEOUT_MS = 45_000;
const STOPPED_SESSION_STATUSES: readonly ChatSessionStatus[] = ["closed", "error"];

export function createAgentChatClient(
  pageURL: string,
  target: ChatTarget,
  location: ILocationHostProtocol,
  settingsStore: DevtoolsSettingsStore,
): IAgentChatClient {
  const saved = settingsStore.getState().chat;
  const scopeQuery = (): URLSearchParams => new URLSearchParams({ pageURL, chatTarget: target });
  const lifetime = new AbortController();
  const listeners = new Set<VoidFunction>();
  const pendingSends = new Map<string, IPendingChatSend>();
  let stream: IReconnectingWebSocket | null = null;
  let generation = 0;
  let sessionTask: Promise<void> | null = null;
  let cancelConnection: VoidFunction | null = null;
  let answerDecision: ChatDecisionHandler | null = null;
  let state: IAgentChatClientState = {
    harnesses: [],
    sessions: [],
    session: null,
    selectedHarness: saved.selectedHarness,
    selectedModel: saved.selectedModel,
    isCatalogLoading: true,
    catalogError: null,
    isConnecting: false,
    isConnected: false,
    sendError: null,
    lastSend: null,
    decision: null,
    joinedSession: null,
    events: [],
    pendingRequestIds: [],
  };
  const publish = (patch: Partial<IAgentChatClientState>): void => {
    if (lifetime.signal.aborted) return;
    state = { ...state, ...patch };
    const current = settingsStore.getState();
    const sessionId = state.session?.id ?? current.chat.sessionId;
    if (
      state.selectedHarness !== current.chat.selectedHarness ||
      state.selectedModel !== current.chat.selectedModel ||
      sessionId !== current.chat.sessionId
    ) {
      current.updateChat({ selectedHarness: state.selectedHarness, selectedModel: state.selectedModel, sessionId });
    }
    for (const listener of listeners) listener();
  };
  const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));
  const settleSend = (commandId: string, state: ChatSentState, error?: string): void => {
    const pending = pendingSends.get(commandId);
    if (!pending) return;
    pendingSends.delete(commandId);
    clearTimeout(pending.timeout);
    if (error !== undefined) pending.reject(new Error(error));
    else pending.resolve(state);
  };
  // The server may have the message whatever happened to this connection, so losing it decides nothing.
  const abandonPendingSends = (): void => {
    for (const commandId of pendingSends.keys()) settleSend(commandId, "unconfirmed");
  };
  const request = async (path: string, init?: RequestInit): Promise<unknown> => {
    const response = await pristineFetch(path, { ...init, signal: lifetime.signal });
    if (!response.ok) throw new Error((await response.text()) || `Chat request failed (${response.status})`);
    return response.status === 204 ? undefined : response.json();
  };
  const detach = (): void => {
    abandonPendingSends();
    generation += 1;
    stream?.close();
    stream = null;
    cancelConnection?.();
    cancelConnection = null;
  };
  const attach = (session: IChatSession): Promise<void> => {
    if (lifetime.signal.aborted) return Promise.reject(new Error("Chat is no longer mounted."));
    detach();
    const current = settingsStore.getState();
    if (current.chat.sessionId !== session.id) current.updateChat({ sessionId: session.id, scroll: null });
    const ownGeneration = generation;
    publish({
      session,
      events: [],
      pendingRequestIds: [],
      isConnecting: true,
      isConnected: false,
      sendError: null,
      lastSend: null,
    });
    return new Promise<void>((resolve, reject) => {
      cancelConnection = () => reject(new Error("The chat connection was replaced."));
      const query = scopeQuery();
      query.set("sessionId", session.id);
      stream = openReconnectingWebSocket(createDevtoolsWebSocketUrl(`/__devhost__/ws/chat?${query}`, location), {
        onMessage(event): void {
          if (ownGeneration !== generation) return;
          try {
            if (typeof event.data !== "string") throw new Error("The chat server sent a non-text frame.");
            const value: unknown = JSON.parse(event.data);
            const frame = readChatServerFrame(value);
            if (frame.sessionId && frame.sessionId !== session.id) return;
            if (frame.type === "command_result") {
              settleSend(frame.commandId, frame.delivery ?? "unconfirmed", frame.error);
              return;
            }
            if (frame.type === "error") {
              abandonPendingSends();
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
            abandonPendingSends();
            publish({ sendError: errorText(error), isConnecting: false });
            reject(error);
          }
        },
        onDisconnect: () => {
          abandonPendingSends();
          publish({ isConnected: false, isConnecting: true });
        },
        onEnd: () => {
          abandonPendingSends();
          publish({ isConnected: false, isConnecting: false });
          reject(new Error("The chat connection closed."));
        },
      });
    });
  };
  const ask = (decision: ChatDecision): Promise<ChatDecisionAnswer> =>
    new Promise((resolve) => {
      answerDecision = resolve;
      publish({ decision });
    });
  const decide = (answer: ChatDecisionAnswer): void => {
    const resolve = answerDecision;
    answerDecision = null;
    publish({ decision: null });
    resolve?.(answer);
  };
  // Starting beside a working agent has two agents editing one checkout, which only the person can accept. Agents
  // devhost started are not asked about, and the list is advisory: a failed scan must not stop a chat.
  const canStartSession = async (): Promise<boolean> => {
    const agents = await readRunningAgents(pageURL, target, lifetime.signal).catch(() => []);
    if (agents.some((agent) => agent.isOwned)) return true;
    const foreign = agents.filter((agent) => agent.state !== "idle");
    if (foreign.length === 0) return true;
    return (await ask({ kind: "agents", agents: foreign })).kind === "start";
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
      if (!resume && !(await canStartSession())) throw new Error("No conversation was started.");
      const sessionRequest: IChatSessionRequest = {
        harness,
        pageURL,
        target,
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
      // A resumed session continues the closed conversation it resumed, which the server no longer lists.
      publish({
        sessions: [...state.sessions.filter((item) => item.id !== session.id && item.id !== resume?.id), session],
      });
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
  const resumeSession = async (session: IChatSession): Promise<void> => {
    if (session.status === "closed") return newSession(session);
    publish({
      selectedHarness: session.harness,
      selectedModel: state.selectedHarness === session.harness ? state.selectedModel : "",
    });
    if (state.session?.id !== session.id || !state.isConnected) await attach(session);
  };
  const sendCommand = (command: ChatCommand): void => {
    if (!state.isConnected || !stream?.send(encodeChatCommand(command)))
      throw new Error("The chat session is disconnected. Reconnect before sending.");
  };
  let shouldRestoreSession = true;
  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async refreshCatalog(): Promise<void> {
      publish({ isCatalogLoading: true, catalogError: null });
      try {
        const query = scopeQuery();
        const [catalog, sessions] = await Promise.all([
          request(`/__devhost__/chat/harnesses?${query}`),
          request(`/__devhost__/chat/sessions?${query}`),
        ]);
        if (lifetime.signal.aborted) return;
        const harnesses = readChatHarnesses(catalog);
        const selected =
          harnesses.find((item) => item.id === state.selectedHarness && item.available) ??
          harnesses.find((item) => item.available);
        publish({
          harnesses,
          sessions: readChatSessions(sessions),
          selectedHarness: selected?.id ?? state.selectedHarness,
          selectedModel:
            selected?.id === state.selectedHarness && selected.models.some((model) => model.id === state.selectedModel)
              ? state.selectedModel
              : "",
          isCatalogLoading: false,
        });
        if (shouldRestoreSession) {
          shouldRestoreSession = false;
          const savedSession = state.sessions.find((session) => session.id === saved.sessionId);
          if (savedSession && savedSession.status !== "closed" && state.session === null && !state.isConnecting) {
            await attach(savedSession);
          } else if (state.session === null && !state.isConnecting) {
            settingsStore.getState().updateChat({ sessionId: null, scroll: null });
          }
        }
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
    resumeSession,
    async joinRunningSession(): Promise<void> {
      publish({ joinedSession: null });
      const sessions = readChatSessions(await request(`/__devhost__/chat/sessions?${scopeQuery()}`));
      publish({ sessions });
      const running = sessions.filter((session) => !STOPPED_SESSION_STATUSES.includes(session.status));
      if (running.length === 0) return;
      const answer =
        running.length === 1
          ? { kind: "join" as const, session: running[0] }
          : await ask({ kind: "sessions", sessions: running });
      if (answer.kind !== "join" || answer.session === undefined) throw new Error("The request was not sent.");
      await resumeSession(answer.session);
      publish({ joinedSession: answer.session });
    },
    decide,
    async closeSession(): Promise<void> {
      const session = state.session;
      if (!session) return;
      // Closing stops the native process; the closed conversation stays listed so it can be resumed.
      const closed = readChatSession(
        await request(`/__devhost__/chat/sessions/${encodeURIComponent(session.id)}/close?${scopeQuery()}`, {
          method: "POST",
        }),
      );
      detach();
      settingsStore.getState().updateChat({ sessionId: null, scroll: null });
      publish({
        session: null,
        sessions: [...state.sessions.filter((item) => item.id !== closed.id), closed],
        events: [],
        pendingRequestIds: [],
        isConnected: false,
        isConnecting: false,
      });
    },
    async send(prepared, originalText): Promise<IChatReceipt> {
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
      const sessionId = state.session?.id;
      if (sessionId === undefined) throw new Error("Chat is no longer mounted.");
      const afterSequence = state.events.at(-1)?.sequence ?? 0;
      publish({ lastSend: { commandId, state: "sending", afterSequence } });
      try {
        const delivery = await new Promise<ChatSentState>((resolve, reject) => {
          const timeout = setTimeout(() => settleSend(commandId, "unconfirmed"), SEND_CONFIRMATION_TIMEOUT_MS);
          pendingSends.set(commandId, { resolve, reject, timeout });
          if (!state.isConnected || !stream?.send(payload)) {
            settleSend(commandId, "unconfirmed", "The chat session is disconnected. Reconnect before sending.");
          }
        });
        publish({ lastSend: { commandId, state: delivery, afterSequence } });
        return { sessionId, commandId };
      } catch (error) {
        publish({ lastSend: { commandId, state: "failed", afterSequence } });
        throw error;
      }
    },
    interrupt: () => sendCommand({ type: "interrupt" }),
    respond(requestId, result): void {
      if (!state.pendingRequestIds.includes(requestId)) throw new Error("This native request is no longer pending.");
      sendCommand({ type: "respond", requestId, result });
    },
    setSendError: (sendError) => publish({ sendError }),
    dispose(): void {
      lifetime.abort();
      answerDecision?.({ kind: "cancel" });
      detach();
      listeners.clear();
    },
  };
}
