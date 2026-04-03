import type { DevtoolsComponentEditor } from "../../devtoolsComponentEditor";

import { readInjectedDevtoolsConfig } from "./readInjectedDevtoolsConfig";

export function readDevtoolsComponentEditor(): DevtoolsComponentEditor {
  return readInjectedDevtoolsConfig().componentEditor;
}
