import type { DevtoolsComponentEditor } from "./devtoolsComponentEditor";
import type { DevtoolsMinimapPosition, DevtoolsPosition } from "../types/stackTypes";
import { DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME } from "../devtools/shared/constants";

export function createConfiguredDevtoolsScript(
  devtoolsScript: string,
  devtoolsPosition: DevtoolsPosition,
  devtoolsMinimapPosition: DevtoolsMinimapPosition,
  componentEditor: DevtoolsComponentEditor,
  projectRootPath: string,
  stackName: string,
  agentDisplayName: string,
  controlToken: string,
): string {
  const injectedConfig: string = JSON.stringify({
    agentDisplayName,
    componentEditor,
    controlToken,
    minimapPosition: devtoolsMinimapPosition,
    position: devtoolsPosition,
    projectRootPath,
    stackName,
  });

  return `globalThis.${DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME}=${injectedConfig};\n${devtoolsScript}`;
}
