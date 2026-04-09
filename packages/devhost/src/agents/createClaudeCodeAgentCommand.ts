export function createClaudeCodeAgentCommand(promptFilePath: string, settingsFilePath?: string): string[] {
  const args = ["claude"];
  if (settingsFilePath) {
    args.push("--settings", settingsFilePath);
  }
  args.push(`Please read the annotation details from ${promptFilePath} and address the requested change.`);
  return args;
}
