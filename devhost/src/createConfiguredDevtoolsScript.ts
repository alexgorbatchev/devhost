import { DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME } from "./devtools/constants";
import type { DevtoolsPosition } from "./stackTypes";

export function createConfiguredDevtoolsScript(
  devtoolsScript: string,
  devtoolsPosition: DevtoolsPosition,
  stackName: string,
): string {
  const injectedConfig: string = JSON.stringify({
    position: devtoolsPosition,
    stackName,
  });

  return `globalThis.${DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME}=${injectedConfig};\n${devtoolsScript}`;
}
