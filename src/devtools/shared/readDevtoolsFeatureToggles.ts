import { readInjectedDevtoolsConfig } from "./readInjectedDevtoolsConfig";

export function readDevtoolsFeatureToggles() {
  const config = readInjectedDevtoolsConfig();
  return {
    editorEnabled: config.editorEnabled,
    minimapEnabled: config.minimapEnabled,
    statusEnabled: config.statusEnabled,
  };
}
