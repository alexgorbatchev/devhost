import type { DevtoolsComponentEditor } from "./devtoolsConfig";

import { readInjectedDevtoolsConfig } from "./readInjectedDevtoolsConfig";

export function readDevtoolsComponentEditor(): DevtoolsComponentEditor {
  return readInjectedDevtoolsConfig().componentEditor;
}
