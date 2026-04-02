import type { DevtoolsPosition } from "../../stackTypes";
import { readInjectedDevtoolsConfig } from "./readInjectedDevtoolsConfig";

export function readDevtoolsPosition(): DevtoolsPosition {
  return readInjectedDevtoolsConfig().position;
}
