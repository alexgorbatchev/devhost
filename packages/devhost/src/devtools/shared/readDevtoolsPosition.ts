import type { DevtoolsPosition } from "./devtoolsConfig";
import { readInjectedDevtoolsConfig } from "./readInjectedDevtoolsConfig";

export function readDevtoolsPosition(): DevtoolsPosition {
  return readInjectedDevtoolsConfig().position;
}
