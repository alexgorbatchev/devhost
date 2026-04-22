import { readInjectedDevtoolsConfig } from "./readInjectedDevtoolsConfig";

export function readDevtoolsAgentDisplayName(): string {
  return readInjectedDevtoolsConfig().agentDisplayName;
}
