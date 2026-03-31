import { DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME } from "./devtools/constants";
import type { DevtoolsMinimapPosition, DevtoolsPosition } from "./stackTypes";

export function createConfiguredDevtoolsScript(
  devtoolsScript: string,
  devtoolsPosition: DevtoolsPosition,
  devtoolsMinimapPosition: DevtoolsMinimapPosition,
  stackName: string,
): string {
  const injectedConfig: string = JSON.stringify({
    minimapPosition: devtoolsMinimapPosition,
    position: devtoolsPosition,
    stackName,
  });

  return `globalThis.${DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME}=${injectedConfig};\n${devtoolsScript}`;
}
