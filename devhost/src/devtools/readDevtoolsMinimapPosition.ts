import type { DevtoolsMinimapPosition } from "../stackTypes";
import { readInjectedDevtoolsConfig } from "./readInjectedDevtoolsConfig";

export function readDevtoolsMinimapPosition(): DevtoolsMinimapPosition {
  return readInjectedDevtoolsConfig().minimapPosition;
}
