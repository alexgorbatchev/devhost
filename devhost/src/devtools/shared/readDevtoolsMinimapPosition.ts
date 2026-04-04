import type { DevtoolsMinimapPosition } from "../../types/stackTypes";
import { readInjectedDevtoolsConfig } from "./readInjectedDevtoolsConfig";

export function readDevtoolsMinimapPosition(): DevtoolsMinimapPosition {
  return readInjectedDevtoolsConfig().minimapPosition;
}
