import type { AssistantRuntime, ThreadMessageLike } from "@assistant-ui/react";
import type { RunningAgent } from "../../shared/readRunningAgents";
import type { ChatTarget, DevtoolsSettingsStore } from "../../shared/types";

export type ChatHarnessId = "codex" | "claude-code";
export type ChatSessionStatus = "starting" | "idle" | "running" | "requires_action" | "closed" | "error";
export type ChatRequestId = string | number;
export interface IChatModel {
  id: string;
  label: string;
  description: string;
}
export interface IChatHarness {
  id: ChatHarnessId;
  label: string;
  available: boolean;
  models: readonly IChatModel[];
  error?: string;
}
/**
 * What is known about a sent message. `unconfirmed` means the outcome is unknown: the agent may already have the
 * message, so nothing resends it. `completed` and `cancelled` come from native frames, after the socket has answered.
 */
export type ChatDeliveryState = "sending" | "queued" | "started" | "completed" | "cancelled" | "unconfirmed" | "failed";
/** The states the server reports for a send. */
export type ChatSentState = "queued" | "started" | "unconfirmed";
export interface IChatSendRecord {
  commandId: string;
  state: ChatDeliveryState;
  /** The last event sequence when this was sent, so later native events can be told from earlier ones. */
  afterSequence: number;
}
export interface IChatDeliveries {
  states: ReadonlyMap<string, ChatDeliveryState>;
  /** Sequence of the last interrupted Codex turn, 0 when there is none. */
  interruptedAt: number;
}
/** The state native frames show for a message, undefined while they show nothing. */
export type ChatDeliveryReader = (commandId: string) => ChatDeliveryState | undefined;
export interface IChatReceipt {
  sessionId: string;
  commandId: string;
}
/** A choice only the person can make: devhost never guesses when a request changes shared project state. */
export type ChatDecision =
  | { kind: "agents"; agents: readonly RunningAgent[] }
  | { kind: "sessions"; sessions: readonly IChatSession[] };
export type ChatDecisionAnswer = { kind: "start" } | { kind: "cancel" } | { kind: "join"; session: IChatSession };
export type ChatDecisionHandler = (answer: ChatDecisionAnswer) => void;
export interface IChatPanelPosition {
  left: number;
  top: number;
}
export interface IChatPanelSize {
  width: number;
  height: number;
}
export interface IChatSession {
  id: string;
  harness: ChatHarnessId;
  projectRootPath: string;
  nativeSessionId?: string;
  status: ChatSessionStatus;
  error?: string;
}
export interface IChatSessionRequest {
  harness: ChatHarnessId;
  pageURL: string;
  target: ChatTarget;
  model?: string;
  resumeId?: string;
}
export interface IChatImage {
  dataURL: string;
}
export interface IChatEvent {
  sequence: number;
  payload: unknown;
}
export interface IChatPendingRequest {
  requestId: ChatRequestId;
  harness: ChatHarnessId;
  method: string;
  payload: unknown;
}
export interface IChatPreparedSend {
  text?: string;
  images?: readonly IChatImage[];
}
export type ChatBeforeSend = (text: string) => IChatPreparedSend | null | Promise<IChatPreparedSend | null>;
export interface IChatSnapshot {
  type: "snapshot";
  sessionId: string;
  session: IChatSession;
  events?: readonly IChatEvent[];
  pendingRequestIds: readonly ChatRequestId[];
}
export interface IChatEventFrame extends IChatEvent {
  type: "event";
  sessionId: string;
}
export interface IChatStateFrame {
  type: "state";
  sessionId: string;
  session: IChatSession;
  pendingRequestIds: readonly ChatRequestId[];
}
export interface IChatErrorFrame {
  type: "error";
  sessionId?: string;
  error: string;
}
export interface IChatCommandResult {
  type: "command_result";
  sessionId: string;
  commandId: string;
  error?: string;
  delivery?: ChatSentState;
}
export type ChatServerFrame = IChatSnapshot | IChatEventFrame | IChatStateFrame | IChatErrorFrame | IChatCommandResult;
export type ChatCommand =
  | { type: "send"; commandId: string; text: string; model: string; images?: readonly IChatImage[] }
  | { type: "interrupt" }
  | { type: "respond"; requestId: ChatRequestId; result: unknown };
export interface IChatProjection {
  messages: readonly ThreadMessageLike[];
  pendingRequests: readonly IChatPendingRequest[];
  events: readonly IChatEvent[];
}
export interface IAgentChatOptions {
  pageURL: string;
  target: ChatTarget;
  settingsStore?: DevtoolsSettingsStore;
  beforeSend?: ChatBeforeSend;
  onSent?: () => void;
}
export interface IAgentChatClientState {
  harnesses: readonly IChatHarness[];
  sessions: readonly IChatSession[];
  session: IChatSession | null;
  selectedHarness: ChatHarnessId;
  selectedModel: string;
  isCatalogLoading: boolean;
  catalogError: string | null;
  isConnecting: boolean;
  isConnected: boolean;
  sendError: string | null;
  lastSend: IChatSendRecord | null;
  decision: ChatDecision | null;
  /** The running conversation a request joined, so the chat can name it. */
  joinedSession: IChatSession | null;
  events: readonly IChatEvent[];
  pendingRequestIds: readonly ChatRequestId[];
}
export interface IAgentChatClient {
  getSnapshot: () => IAgentChatClientState;
  subscribe: (listener: () => void) => () => void;
  refreshCatalog: () => Promise<void>;
  setSelectedHarness: (harness: ChatHarnessId) => void;
  setSelectedModel: (model: string) => void;
  newSession: () => Promise<void>;
  resumeSession: (session: IChatSession) => Promise<void>;
  closeSession: () => Promise<void>;
  /** Attaches the conversation already running in the project, asking when there are several; none is not an error. */
  joinRunningSession: () => Promise<void>;
  decide: ChatDecisionHandler;
  /** Resolves unless the message definitely failed; an unknown outcome resolves too, so nothing resends it. */
  send: (prepared: IChatPreparedSend, originalText: string) => Promise<IChatReceipt>;
  interrupt: () => void;
  respond: (requestId: ChatRequestId, result: unknown) => void;
  setSendError: (message: string | null) => void;
  dispose: () => void;
}
export interface IAgentChatController {
  isAwaitingReply: boolean;
  replyAfterMessageId?: string;
  settingsStore: DevtoolsSettingsStore;
  runtime: AssistantRuntime;
  isHistoryReady: boolean;
  isPreparing: boolean;
  harnesses: readonly IChatHarness[];
  isCatalogLoading: boolean;
  catalogError: string | null;
  selectedHarness: ChatHarnessId;
  setSelectedHarness: (harness: ChatHarnessId) => void;
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  sessions: readonly IChatSession[];
  session: IChatSession | null;
  isConnecting: boolean;
  isConnected: boolean;
  sendError: string | null;
  decision: ChatDecision | null;
  decide: ChatDecisionHandler;
  joinedSession: IChatSession | null;
  /** The latest message's state, null before the first send of a conversation. */
  deliveryState: ChatDeliveryState | null;
  readDelivery: ChatDeliveryReader;
  pendingRequests: readonly IChatPendingRequest[];
  events: readonly IChatEvent[];
  refreshCatalog: () => Promise<void>;
  newSession: () => Promise<void>;
  resumeSession: (session: IChatSession) => Promise<void>;
  closeSession: () => Promise<void>;
  /**
   * Sends a request that acts on shared project state, without page context or the composer's draft. It joins a
   * running conversation rather than starting a second agent. Resolves to null when the send definitely failed.
   */
  sendMessage: (text: string) => Promise<IChatReceipt | null>;
  interrupt: () => void;
  respond: (requestId: ChatRequestId, result: unknown) => void;
}
