export function createClaudeCodeAgentCommand(promptFilePath: string): string[] {
  return ["claude", `Please read the annotation details from ${promptFilePath} and address the requested change.`];
}
