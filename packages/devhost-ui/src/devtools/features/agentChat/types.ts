import type { AssistantRuntime, ThreadMessageLike } from "@assistant-ui/react";
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
  send: (prepared: IChatPreparedSend, originalText: string) => Promise<void>;
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
  pendingRequests: readonly IChatPendingRequest[];
  events: readonly IChatEvent[];
  refreshCatalog: () => Promise<void>;
  newSession: () => Promise<void>;
  resumeSession: (session: IChatSession) => Promise<void>;
  closeSession: () => Promise<void>;
  /** Sends text without page context or the composer's draft. Resolves to whether the agent accepted it. */
  sendMessage: (text: string) => Promise<boolean>;
  interrupt: () => void;
  respond: (requestId: ChatRequestId, result: unknown) => void;
}
