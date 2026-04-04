import { fileURLToPath } from "node:url";

const autoExitOnAgentEndExtensionPath: string = fileURLToPath(
  import.meta.resolve("./registerAutoExitOnAgentEndExtension.ts"),
);

export function createPiAgentCommand(prompt: string): string[] {
  return ["pi", "-e", autoExitOnAgentEndExtensionPath, prompt];
}
