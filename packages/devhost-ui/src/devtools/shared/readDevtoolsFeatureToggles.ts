import { readInjectedDevtoolsConfig } from "./readInjectedDevtoolsConfig";

export function readDevtoolsFeatureToggles() {
  const config = readInjectedDevtoolsConfig();
  return {
    annotationEnabled: config.annotationEnabled,
    annotationQueueEnabled: config.annotationQueueEnabled,
    editorEnabled: config.editorEnabled,
    externalToolbarsEnabled: config.externalToolbarsEnabled,
    minimapEnabled: config.minimapEnabled,
    statusEnabled: config.statusEnabled,
    terminalEnabled: config.terminalEnabled,
  };
}
