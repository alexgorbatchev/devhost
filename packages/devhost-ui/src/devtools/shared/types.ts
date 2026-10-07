import type { IStandardSourceShape } from "./reactSourceInspection";
import type { IRoutedServiceIdentity } from "./routedServices";

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

export type HealthResponse = {
  routing?: IRoutingConfig;
  services: ServiceHealth[];
  repositories?: IWorktreeRepository[];
};

export interface IRoutingConfig {
  primaryService: string;
  routedServices: IRoutedServiceIdentity[];
}

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
