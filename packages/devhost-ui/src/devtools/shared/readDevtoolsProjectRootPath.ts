import { readInjectedDevtoolsConfig } from "./readInjectedDevtoolsConfig";

export function readDevtoolsProjectRootPath(): string {
  return readInjectedDevtoolsConfig().projectRootPath;
}
