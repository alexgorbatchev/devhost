import type { DevtoolsComponentEditor } from "./devtoolsComponentEditor";
import type { DevtoolsMinimapPosition, DevtoolsPosition } from "../types/stackTypes";
import { DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME } from "../devtools/shared/constants";
import type { IRoutedServiceIdentity } from "../devtools/shared/routedServices";

export function createConfiguredDevtoolsScript(
  devtoolsScript: string,
  devtoolsPosition: DevtoolsPosition,
  devtoolsMinimapPosition: DevtoolsMinimapPosition,
  componentEditor: DevtoolsComponentEditor,
  projectRootPath: string,
  stackName: string,
  agentDisplayName: string,
  controlToken: string,
  editorEnabled: boolean = true,
  externalToolbarsEnabled: boolean = true,
  minimapEnabled: boolean = true,
  statusEnabled: boolean = true,
  annotationEnabled: boolean = true,
  annotationQueueEnabled: boolean = true,
  terminalEnabled: boolean = true,
  routedServices: IRoutedServiceIdentity[] = [],
): string {
  const injectedConfig: string = JSON.stringify({
    agentDisplayName,
    annotationEnabled,
    annotationQueueEnabled,
    componentEditor,
    controlToken,
    minimapPosition: devtoolsMinimapPosition,
    position: devtoolsPosition,
    projectRootPath,
    stackName,
    editorEnabled,
    externalToolbarsEnabled,
    minimapEnabled,
    statusEnabled,
    terminalEnabled,
    routedServices,
  });

  return `globalThis.${DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME}=${injectedConfig};\n${devtoolsScript}`;
}
