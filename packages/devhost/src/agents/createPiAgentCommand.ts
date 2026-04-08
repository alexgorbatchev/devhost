export function createPiAgentCommand(promptFilePath: string): string[] {
  return ["pi", `@${promptFilePath}`];
}
