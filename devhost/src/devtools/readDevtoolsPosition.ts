import type { DevtoolsPosition } from "../stackTypes";
import { DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME } from "./constants";

export function readDevtoolsPosition(): DevtoolsPosition {
  const injectedConfig: unknown = Reflect.get(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME);

  if (typeof injectedConfig !== "object" || injectedConfig === null) {
    return "bottom-right";
  }

  const position: unknown = Reflect.get(injectedConfig, "position");

  if (
    position === "top-left" ||
    position === "top-right" ||
    position === "bottom-left" ||
    position === "bottom-right"
  ) {
    return position;
  }

  return "bottom-right";
}
