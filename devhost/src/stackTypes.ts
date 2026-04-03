import type { DevtoolsComponentEditor } from "./devtoolsComponentEditor";

export type SupportedSignal = "SIGINT" | "SIGTERM" | "SIGHUP";

export type DevhostHealthConfig =
  | {
      tcp: number;
    }
  | {
      http: string;
    }
  | {
      process: true;
    };

export type DevhostPortConfig = number | "auto";

export type DevtoolsPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";
export type DevtoolsMinimapPosition = "left" | "right";

export interface IDevhostAgentConfig {
  command: string[];
  cwd?: string;
  displayName: string;
  env?: Record<string, string>;
}

export interface IDefaultDevhostAgent {
  displayName: string;
  kind: "pi";
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
  agent?: IDevhostAgentConfig;
  name: string;
  primaryService: string;
  devtools?: boolean;
  devtoolsComponentEditor?: DevtoolsComponentEditor;
  devtoolsMinimapPosition?: DevtoolsMinimapPosition;
  devtoolsPosition?: DevtoolsPosition;
  services: Record<string, IDevhostServiceConfig>;
}

export interface IDevhostServiceConfig {
  command: string[];
  cwd?: string;
  env?: Record<string, string>;
  port?: DevhostPortConfig;
  bindHost?: string;
  host?: string;
  dependsOn?: string[];
  health?: DevhostHealthConfig;
}

export interface IValidatedDevhostManifest {
  agent: ValidatedDevhostAgent;
  name: string;
  primaryService: string;
  manifestPath: string;
  manifestDirectoryPath: string;
  devtools: boolean;
  devtoolsComponentEditor: DevtoolsComponentEditor;
  devtoolsMinimapPosition: DevtoolsMinimapPosition;
  devtoolsPosition: DevtoolsPosition;
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
  dependsOn: string[];
  health: DevhostHealthConfig | null;
}

export interface IResolvedDevhostManifest {
  agent: ValidatedDevhostAgent;
  name: string;
  primaryService: string;
  manifestPath: string;
  manifestDirectoryPath: string;
  devtools: boolean;
  devtoolsComponentEditor: DevtoolsComponentEditor;
  devtoolsMinimapPosition: DevtoolsMinimapPosition;
  devtoolsPosition: DevtoolsPosition;
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
  dependsOn: string[];
  health: ResolvedHealthConfig;
  portSource: "fixed" | "auto" | "none";
}

export type ResolvedHealthConfig =
  | {
      kind: "tcp";
      host: string;
      port: number;
    }
  | {
      kind: "http";
      url: string;
    }
  | {
      kind: "process";
    };

export interface IInjectedServiceEnvironment {
  DEVHOST_BIND_HOST: string;
  DEVHOST_HOST?: string;
  DEVHOST_MANIFEST_PATH?: string;
  DEVHOST_SERVICE_NAME?: string;
  DEVHOST_STACK?: string;
  PORT?: string;
}

export type SignalHandlerCallback = (signal: SupportedSignal) => void;

export interface ISignalHandlerRegistration {
  handler: () => void;
  signalName: SupportedSignal;
}

export type RuntimeMode = "manifest" | "single-service";

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
