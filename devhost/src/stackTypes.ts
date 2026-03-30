export type DevhostReadyConfig =
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

export interface IDevhostManifest {
  name: string;
  primaryService: string;
  devtools?: boolean;
  services: Record<string, IDevhostServiceConfig>;
}

export interface IDevhostServiceConfig {
  command: string[];
  cwd?: string;
  env?: Record<string, string>;
  port?: DevhostPortConfig;
  bindHost?: string;
  publicHost?: string;
  dependsOn?: string[];
  ready?: DevhostReadyConfig;
}

export interface IValidatedDevhostManifest {
  name: string;
  primaryService: string;
  manifestPath: string;
  manifestDirectoryPath: string;
  devtools: boolean;
  services: Record<string, IValidatedDevhostService>;
}

export interface IValidatedDevhostService {
  name: string;
  command: string[];
  cwd: string;
  env: Record<string, string>;
  port: DevhostPortConfig | null;
  bindHost: string;
  publicHost: string | null;
  dependsOn: string[];
  ready: DevhostReadyConfig | null;
}

export interface IResolvedDevhostManifest {
  name: string;
  primaryService: string;
  manifestPath: string;
  manifestDirectoryPath: string;
  devtools: boolean;
  services: Record<string, IResolvedDevhostService>;
}

export interface IResolvedDevhostService {
  name: string;
  command: string[];
  cwd: string;
  env: Record<string, string>;
  port: number | null;
  bindHost: string;
  publicHost: string | null;
  dependsOn: string[];
  ready: ResolvedReadyConfig;
  portSource: "fixed" | "auto" | "none";
}

export type ResolvedReadyConfig =
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
  DEVHOST_STACK: string;
  DEVHOST_SERVICE: string;
  DEVHOST_BIND_HOST: string;
  DEVHOST_MANIFEST_PATH: string;
  PORT?: string;
  DEVHOST_PUBLIC_HOST?: string;
  HOST?: string;
}
