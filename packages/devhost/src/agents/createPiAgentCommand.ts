import { fileURLToPath } from "node:url";

const agentStatusExtensionPath: string = fileURLToPath(import.meta.resolve("./registerAgentStatusExtension.ts"));

export function createPiAgentCommand(promptFilePath: string): string[] {
  return ["pi", "-e", agentStatusExtensionPath, `@${promptFilePath}`];
}
