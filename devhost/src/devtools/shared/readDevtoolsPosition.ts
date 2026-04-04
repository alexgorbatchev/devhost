import type { DevtoolsPosition } from "../../types/stackTypes";
import { readInjectedDevtoolsConfig } from "./readInjectedDevtoolsConfig";

export function readDevtoolsPosition(): DevtoolsPosition {
  return readInjectedDevtoolsConfig().position;
}
