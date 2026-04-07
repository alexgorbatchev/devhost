import type { DevtoolsComponentEditor } from "../../devtools-server/devtoolsComponentEditor";

import { readInjectedDevtoolsConfig } from "./readInjectedDevtoolsConfig";

export function readDevtoolsComponentEditor(): DevtoolsComponentEditor {
  return readInjectedDevtoolsConfig().componentEditor;
}
