export function createOpenCodeAgentCommand(promptFilePath: string): string[] {
  return ["opencode", `Please read the annotation details from ${promptFilePath} and address the requested change.`];
}
