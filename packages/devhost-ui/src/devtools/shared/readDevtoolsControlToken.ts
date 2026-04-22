import { readInjectedDevtoolsConfig } from "./readInjectedDevtoolsConfig";

export function readDevtoolsControlToken(): string {
  return readInjectedDevtoolsConfig().controlToken;
}
