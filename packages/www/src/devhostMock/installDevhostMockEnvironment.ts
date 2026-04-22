import type { IInjectedDevtoolsConfig } from "../devtoolsContracts/types";

import type { MarketingRecordingScenarioId } from "../marketing/replays/marketingReplayScenarios";

const mockStackName: string = "www-marketing-capture";
type TeardownFunction = () => void;

declare global {
  interface Window {
    __DEVHOST_CAPTURE_PROJECT_ROOT__?: string;
  }
}

export function installDevhostMockEnvironment(scenarioId: MarketingRecordingScenarioId): TeardownFunction {
  const hadInjectedConfig: boolean = Reflect.has(window, "__DEVHOST_INJECTED_CONFIG__");
  const previousInjectedConfig: unknown = Reflect.get(window, "__DEVHOST_INJECTED_CONFIG__");

  Object.defineProperty(window, "__DEVHOST_INJECTED_CONFIG__", {
    configurable: true,
    value: createInjectedConfig(window.location, scenarioId),
    writable: true,
  });

  return (): void => {
    if (!hadInjectedConfig) {
      Reflect.deleteProperty(window, "__DEVHOST_INJECTED_CONFIG__");
      return;
    }

    Object.defineProperty(window, "__DEVHOST_INJECTED_CONFIG__", {
      configurable: true,
      value: previousInjectedConfig,
      writable: true,
    });
  };
}

function createInjectedConfig(location: Location, scenarioId: MarketingRecordingScenarioId): IInjectedDevtoolsConfig {
  return {
    agentDisplayName: "Pi",
    annotationEnabled: true,
    annotationQueueEnabled: true,
    componentEditor: "neovim",
    controlToken: scenarioId,
    editorEnabled: true,
    externalToolbarsEnabled: false,
    minimapEnabled: true,
    position: "top-right",
    projectRootPath: readCaptureProjectRootPath(),
    routedServices: [
      { host: location.hostname, path: "/", serviceName: "app" },
      { host: location.hostname, path: "/api", serviceName: "api" },
      { host: `worker.${location.hostname}`, path: "/", serviceName: "worker" },
    ],
    stackName: mockStackName,
    statusEnabled: true,
    terminalEnabled: true,
  };
}

function readCaptureProjectRootPath(): string {
  return typeof window.__DEVHOST_CAPTURE_PROJECT_ROOT__ === "string" ? window.__DEVHOST_CAPTURE_PROJECT_ROOT__ : "";
}
