import type { DevtoolsMinimapPosition, DevtoolsPosition } from "../../types/stackTypes";
import { createDefaultDevhostAgent } from "../../agents/createDefaultDevhostAgent";
import {
  defaultDevtoolsComponentEditor,
  readDevtoolsComponentEditorValue,
  type DevtoolsComponentEditor,
} from "../../devtools-server/devtoolsComponentEditor";
import { DEVHOST_SERVICE_NAME, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME } from "./constants";

export interface IInjectedDevtoolsConfig {
  agentDisplayName: string;
  componentEditor: DevtoolsComponentEditor;
  controlToken: string;
  minimapPosition: DevtoolsMinimapPosition;
  position: DevtoolsPosition;
  projectRootPath: string;
  stackName: string;
  editorEnabled: boolean;
  externalToolbarsEnabled: boolean;
  minimapEnabled: boolean;
  statusEnabled: boolean;
}

const defaultInjectedDevtoolsConfig: IInjectedDevtoolsConfig = {
  agentDisplayName: createDefaultDevhostAgent().displayName,
  componentEditor: defaultDevtoolsComponentEditor,
  controlToken: "",
  minimapPosition: "right",
  position: "bottom-right",
  projectRootPath: "",
  stackName: DEVHOST_SERVICE_NAME,
  editorEnabled: true,
  externalToolbarsEnabled: true,
  minimapEnabled: true,
  statusEnabled: true,
};

export function readInjectedDevtoolsConfig(): IInjectedDevtoolsConfig {
  const injectedConfig: unknown = Reflect.get(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME);

  if (typeof injectedConfig !== "object" || injectedConfig === null) {
    return defaultInjectedDevtoolsConfig;
  }

  const agentDisplayName: string = readAgentDisplayNameValue(injectedConfig);
  const componentEditor: DevtoolsComponentEditor = readComponentEditorValue(injectedConfig);
  const controlToken: string = readControlTokenValue(injectedConfig);
  const position: DevtoolsPosition = readDevtoolsPositionValue(injectedConfig);
  const minimapPosition: DevtoolsMinimapPosition = readDevtoolsMinimapPositionValue(injectedConfig);
  const projectRootPath: string = readProjectRootPathValue(injectedConfig);
  const stackName: string = readStackNameValue(injectedConfig);
  const editorEnabled: boolean = readBooleanValue(injectedConfig, "editorEnabled", true);
  const externalToolbarsEnabled: boolean = readBooleanValue(injectedConfig, "externalToolbarsEnabled", true);
  const minimapEnabled: boolean = readBooleanValue(injectedConfig, "minimapEnabled", true);
  const statusEnabled: boolean = readBooleanValue(injectedConfig, "statusEnabled", true);

  return {
    agentDisplayName,
    componentEditor,
    controlToken,
    minimapPosition,
    position,
    projectRootPath,
    stackName,
    editorEnabled,
    externalToolbarsEnabled,
    minimapEnabled,
    statusEnabled,
  };
}

function readAgentDisplayNameValue(injectedConfig: object): string {
  const agentDisplayName: unknown = Reflect.get(injectedConfig, "agentDisplayName");

  return typeof agentDisplayName === "string" && agentDisplayName.trim().length > 0
    ? agentDisplayName
    : defaultInjectedDevtoolsConfig.agentDisplayName;
}

function readComponentEditorValue(injectedConfig: object): DevtoolsComponentEditor {
  const componentEditor: unknown = Reflect.get(injectedConfig, "componentEditor");

  return readDevtoolsComponentEditorValue(componentEditor);
}

function readControlTokenValue(injectedConfig: object): string {
  const controlToken: unknown = Reflect.get(injectedConfig, "controlToken");

  return typeof controlToken === "string" ? controlToken : defaultInjectedDevtoolsConfig.controlToken;
}

function readDevtoolsPositionValue(injectedConfig: object): DevtoolsPosition {
  const position: unknown = Reflect.get(injectedConfig, "position");

  if (
    position === "top-left" ||
    position === "top-right" ||
    position === "bottom-left" ||
    position === "bottom-right"
  ) {
    return position;
  }

  return defaultInjectedDevtoolsConfig.position;
}

function readDevtoolsMinimapPositionValue(injectedConfig: object): DevtoolsMinimapPosition {
  const minimapPosition: unknown = Reflect.get(injectedConfig, "minimapPosition");

  if (minimapPosition === "left" || minimapPosition === "right") {
    return minimapPosition;
  }

  return defaultInjectedDevtoolsConfig.minimapPosition;
}

function readProjectRootPathValue(injectedConfig: object): string {
  const projectRootPath: unknown = Reflect.get(injectedConfig, "projectRootPath");

  return typeof projectRootPath === "string" ? projectRootPath : defaultInjectedDevtoolsConfig.projectRootPath;
}

function readStackNameValue(injectedConfig: object): string {
  const stackName: unknown = Reflect.get(injectedConfig, "stackName");

  return typeof stackName === "string" && stackName.length > 0 ? stackName : defaultInjectedDevtoolsConfig.stackName;
}

function readBooleanValue(injectedConfig: object, key: string, defaultValue: boolean): boolean {
  const value = Reflect.get(injectedConfig, key);
  return typeof value === "boolean" ? value : defaultValue;
}
