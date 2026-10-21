import type { IStandardSourceShape } from "./reactSourceInspection";
import type { StoreApi } from "zustand/vanilla";
import type { StateStorage } from "zustand/middleware";

export type GetSettingsStorage = () => StateStorage;

export interface IChatScrollPosition {
  top: number;
  left: number;
  isAtBottom: boolean;
}

export interface IChatViewSettings {
  isOpen: boolean;
  side: "left" | "right";
  selectedHarness: "codex" | "claude-code";
  selectedModel: string;
  sessionId: string | null;
  draft: string;
  scroll: IChatScrollPosition | null;
}

export interface IDevtoolsSettingsScope {
  projectRootPath: string;
  pageURL: string;
}

export interface IDevtoolsSettings {
  chat: IChatViewSettings;
}

export interface IDevtoolsSettingsState extends IDevtoolsSettings {
  updateChat: (patch: Partial<IChatViewSettings>) => void;
}

export type DevtoolsSettingsStore = StoreApi<IDevtoolsSettingsState>;

export type ServiceHealth = {
  managed: boolean;
  name: string;
  status: boolean;
  url?: string;
  dirty?: boolean; // Indicates file changes have been detected
  restarting?: boolean; // Indicates service is actively in process of restarting
  exitCode?: number;
  projectRootPath?: string;
};

/** A manifest service the run has not started. */
export interface IStoppedService {
  name: string;
}

/** A configuration a reload reads: the manifest with the files it includes, or the shared devhost config file. */
export type ConfigurationSource = "manifest" | "config";

/** The reloads of one configuration source. */
export interface IConfigurationStatus {
  source: ConfigurationSource;
  /** Finished reloads, accepted or rejected, so a page that saved a file can tell when the next one is done. */
  reloads: number;
  /** Why the last reload was rejected; absent after an accepted one. */
  error?: string;
}

export type HealthResponse = {
  // The configuration `/__devhost__/config.json` serves, current at the time of the message.
  config?: object;
  configuration?: IConfigurationStatus[];
  services: ServiceHealth[];
  stoppedServices?: IStoppedService[];
  repositories?: IWorktreeRepository[];
};

export interface IWorktreeDirectory {
  name: string;
  cwd: string;
}

export interface IWorktree {
  path: string;
  branch: string;
  head: string;
  detached: boolean;
  available: boolean;
  reason?: string;
  directories: IWorktreeDirectory[];
}

export interface IWorktreeRepository {
  id: string;
  name: string;
  defaultBranch: string;
  configuredPath: string;
  selectedPath: string;
  runningPath: string;
  serviceNames: string[];
  worktrees: IWorktree[];
  switching: boolean;
  error?: string;
  blockedReason?: string;
}

export type ServiceLogStream = "stdout" | "stderr";

export type ServiceLogEntry = {
  id: number;
  line: string;
  serviceName: string;
  stream: ServiceLogStream;
};

export type ServiceLogSnapshotMessage = {
  entries: ServiceLogEntry[];
  type: "snapshot";
};

export type ServiceLogUpdateMessage = {
  entry: ServiceLogEntry;
  type: "entry";
};

export type ServiceLogMessage = ServiceLogSnapshotMessage | ServiceLogUpdateMessage;

type ReactFunctionLocationTuple = [string, string, number, number];

export type NormalizedSourceValue = ReactFunctionLocationTuple | IStandardSourceShape | null | undefined;

export interface ILocationHostProtocol {
  host: string;
  protocol: string;
}
