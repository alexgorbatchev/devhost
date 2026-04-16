import type { IInjectedDevtoolsConfig } from "@alexgorbatchev/devhost/src/devtools/shared/readInjectedDevtoolsConfig";

import type { MarketingRecordingScenarioId } from "../features/marketingRecording/marketingRecordingScenarios";

const mockProjectRootPath: string = "/Users/alex/development/projects/devhost/packages/www";
const mockStackName: string = "www-marketing-capture";
type TeardownFunction = () => void;

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
    componentEditor: "neovim",
    controlToken: scenarioId,
    editorEnabled: true,
    externalToolbarsEnabled: false,
    minimapEnabled: true,
    minimapPosition: "right",
    position: "top-right",
    projectRootPath: mockProjectRootPath,
    routedServices: [
      { host: location.hostname, path: "/", serviceName: "app" },
      { host: location.hostname, path: "/api", serviceName: "api" },
      { host: `worker.${location.hostname}`, path: "/", serviceName: "worker" },
    ],
    stackName: mockStackName,
    statusEnabled: true,
  };
}
