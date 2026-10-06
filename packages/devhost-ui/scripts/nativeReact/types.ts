export interface INativeReactAssetProof {
  path: string;
  bytes: number;
  sha256: string;
}

export interface INativeReactProvisioning {
  chromeArchivePath: string;
  reactCrxPath: string;
  caddyExecutablePath: string;
  devhostExecutablePath: string;
}

export interface INativeReactTarget {
  id: string;
  type: string;
  url: string;
  parentId?: string;
  webSocketDebuggerUrl?: string;
}

export interface INativeReactBrowser {
  endpoint: string;
  profilePath: string;
  extensionId: string;
  stop: () => Promise<void>;
}

export interface INativeReactProject {
  name: string;
  url: string;
  aliasUrl: string;
  manifestPath: string;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

export interface INativeReactStack {
  projects: INativeReactProject[];
  stop: () => Promise<void>;
}

export interface INativeReactAutomation {
  run: (targetId: string, label: string, argumentsList: string[]) => Promise<string>;
  stop: () => Promise<void>;
}

export interface INativeReactFixtureControls {
  setExternalToolbarsEnabled: (isEnabled: boolean) => void;
  unmountDevhost: () => void;
  mountDevhost: () => void;
  unmountHost: () => void;
  mountHost: () => void;
}
