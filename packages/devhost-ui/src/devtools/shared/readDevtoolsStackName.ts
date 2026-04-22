import { readInjectedDevtoolsConfig } from "./readInjectedDevtoolsConfig";

export function readDevtoolsStackName(): string {
  return readInjectedDevtoolsConfig().stackName;
}
