import type { DevtoolsComponentEditor } from "../devtools-server/devtoolsComponentEditor";

export type SupportedSignal = "SIGINT" | "SIGTERM" | "SIGHUP";

export interface IDevhostHealthBaseConfig {
  interval?: number;
  timeout?: number;
  retries?: number;
}

export type DevhostHealthConfig =
  | ({ tcp: number } & IDevhostHealthBaseConfig)
  | ({ http: string } & IDevhostHealthBaseConfig)
  | ({ process: true } & IDevhostHealthBaseConfig);

export type DevhostPortConfig = number | "auto";

export type DevtoolsPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";
export type DevtoolsMinimapPosition = "left" | "right";

export type BuiltInDevhostAgentAdapter = "pi" | "claude-code" | "opencode";

export interface IBuiltInDevhostAgentConfig {
  adapter: BuiltInDevhostAgentAdapter;
}

export interface ICustomDevhostAgentConfig {
  command: string[];
  cwd?: string;
  displayName: string;
  env?: Record<string, string>;
}

export type DevhostAgentConfig = IBuiltInDevhostAgentConfig | ICustomDevhostAgentConfig;

export interface IDefaultDevhostAgent {
  displayName: string;
  kind: BuiltInDevhostAgentAdapter;
}

export interface IConfiguredDevhostAgent {
  command: string[];
  cwd: string;
  displayName: string;
  env: Record<string, string>;
  kind: "configured";
}

export type ValidatedDevhostAgent = IDefaultDevhostAgent | IConfiguredDevhostAgent;

export interface IDevhostManifest {
  agent?: DevhostAgentConfig;
  name: string;
  devtools?: {
    editor?: {
      enabled?: boolean;
      ide?: DevtoolsComponentEditor;
    };
    externalToolbars?: {
      enabled?: boolean;
    };
    minimap?: {
      enabled?: boolean;
      position?: DevtoolsMinimapPosition;
    };
    status?: {
      enabled?: boolean;
      position?: DevtoolsPosition;
    };
  };
  services: Record<string, IDevhostServiceConfig>;
}

export interface IDevhostServiceConfig {
  primary?: boolean;
  command: string | string[];
  cwd?: string;
  env?: Record<string, string>;
  port?: DevhostPortConfig;
  bindHost?: string;
  host?: string;
  path?: string;
  dependsOn?: string[];
  health?: DevhostHealthConfig;
}

export interface IValidatedDevhostManifest {
  agent: ValidatedDevhostAgent;
  name: string;
  primaryService: string; // resolved internally
  manifestPath: string;
  manifestDirectoryPath: string;
  devtools: {
    editor: {
      enabled: boolean;
      ide: DevtoolsComponentEditor;
    };
    externalToolbars: {
      enabled: boolean;
    };
    minimap: {
      enabled: boolean;
      position: DevtoolsMinimapPosition;
    };
    status: {
      enabled: boolean;
      position: DevtoolsPosition;
    };
  };
  services: Record<string, IValidatedDevhostService>;
}

export interface IValidatedDevhostService {
  name: string;
  command: string[];
  cwd: string;
  env: Record<string, string>;
  port: DevhostPortConfig | null;
  bindHost: string;
  host: string | null;
  path: string | null;
  dependsOn: string[];
  health: DevhostHealthConfig | null;
}

export interface IResolvedDevhostManifest {
  agent: ValidatedDevhostAgent;
  name: string;
  primaryService: string;
  manifestPath: string;
  manifestDirectoryPath: string;
  devtools: {
    editor: {
      enabled: boolean;
      ide: DevtoolsComponentEditor;
    };
    externalToolbars: {
      enabled: boolean;
    };
    minimap: {
      enabled: boolean;
      position: DevtoolsMinimapPosition;
    };
    status: {
      enabled: boolean;
      position: DevtoolsPosition;
    };
  };
  services: Record<string, IResolvedDevhostService>;
}

export interface IResolvedDevhostService {
  name: string;
  command: string[];
  cwd: string;
  env: Record<string, string>;
  port: number | null;
  bindHost: string;
  host: string | null;
  path: string | null;
  dependsOn: string[];
  health: ResolvedHealthConfig;
  portSource: "fixed" | "auto" | "none";
}

export interface IResolvedHealthBaseConfig {
  interval: number;
  timeout: number;
  retries: number;
}

export type ResolvedHealthConfig =
  | ({
      kind: "tcp";
      host: string;
      port: number;
    } & IResolvedHealthBaseConfig)
  | ({
      kind: "http";
      url: string;
    } & IResolvedHealthBaseConfig)
  | ({
      kind: "process";
    } & IResolvedHealthBaseConfig);

export interface IInjectedServiceEnvironment {
  DEVHOST_BIND_HOST: string;
  DEVHOST_HOST?: string;
  DEVHOST_PATH?: string;
  DEVHOST_MANIFEST_PATH?: string;
  DEVHOST_SERVICE_NAME?: string;
  PORT?: string;
}

export type SignalHandlerCallback = (signal: SupportedSignal) => void;

export interface ISignalHandlerRegistration {
  handler: () => void;
  signalName: SupportedSignal;
}

export interface IServiceExitResult {
  serviceName: string;
  exitCode: number;
}

export interface ISignalRaceResult {
  type: "signal";
  signal: SupportedSignal;
}

export interface IExitRaceResult {
  type: "exit";
  serviceName: string;
  exitCode: number;
}

export type RaceResult = ISignalRaceResult | IExitRaceResult;
