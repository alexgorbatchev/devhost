export function createClaudeCodeAgentCommand(prompt: string): string[] {
  return ["claude", prompt];
}
