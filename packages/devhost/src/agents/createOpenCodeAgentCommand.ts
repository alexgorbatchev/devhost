export function createOpenCodeAgentCommand(promptFilePath: string): string[] {
  const args = ["opencode"];
  args.push(`Please read the annotation details from ${promptFilePath} and address the requested change.`);
  return args;
}
