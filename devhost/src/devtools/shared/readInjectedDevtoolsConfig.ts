import type { DevtoolsMinimapPosition, DevtoolsPosition } from "../../stackTypes";
import { DEVHOST_SERVICE_NAME, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME } from "./constants";

export interface IInjectedDevtoolsConfig {
  minimapPosition: DevtoolsMinimapPosition;
  position: DevtoolsPosition;
  stackName: string;
}

const defaultInjectedDevtoolsConfig: IInjectedDevtoolsConfig = {
  minimapPosition: "right",
  position: "bottom-right",
  stackName: DEVHOST_SERVICE_NAME,
};

export function readInjectedDevtoolsConfig(): IInjectedDevtoolsConfig {
  const injectedConfig: unknown = Reflect.get(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME);

  if (typeof injectedConfig !== "object" || injectedConfig === null) {
    return defaultInjectedDevtoolsConfig;
  }

  const position: DevtoolsPosition = readDevtoolsPositionValue(injectedConfig);
  const minimapPosition: DevtoolsMinimapPosition = readDevtoolsMinimapPositionValue(injectedConfig);
  const stackName: string = readStackNameValue(injectedConfig);

  return {
    minimapPosition,
    position,
    stackName,
  };
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

function readStackNameValue(injectedConfig: object): string {
  const stackName: unknown = Reflect.get(injectedConfig, "stackName");

  return typeof stackName === "string" && stackName.length > 0 ? stackName : defaultInjectedDevtoolsConfig.stackName;
}
