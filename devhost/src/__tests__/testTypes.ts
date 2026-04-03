export type TestPromiseVoid = () => Promise<void>;
export type TestPromiseBoolean = () => Promise<boolean>;

export type TestTerminalDataHandler = (data: Uint8Array) => void;
export type TestTerminalExitResolver = (value: number) => void;

export type TestResizeEvent = { cols: number; rows: number };

export type TestTerminalStub = {
  closeCount: number;
  emit: (text: string) => void;
  exitWith: (exitCode: number, signalCode: string | null) => void;
  resizes: Array<TestResizeEvent>;
  start: (
    request: import("../devtools/features/terminalSessions/types").StartTerminalSessionRequest,
    onData: TestTerminalDataHandler,
  ) => import("../launchTerminalSession").ILaunchedTerminalSession;
  startedRequests: import("../devtools/features/terminalSessions/types").StartTerminalSessionRequest[];
  writes: string[];
};

export type TestSessionStartResponse = { sessionId: string };

export type AgentEndContext = { shutdown: () => void };
export type AgentEndHandler = (event: unknown, ctx: AgentEndContext) => Promise<void> | void;

export type TestCleanupFunction = () => void;

export type TestFetchInput = RequestInfo | URL;
