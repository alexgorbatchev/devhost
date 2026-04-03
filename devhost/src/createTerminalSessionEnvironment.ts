export function createTerminalSessionEnvironment(
  baseEnvironment: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return {
    ...baseEnvironment,
    COLORTERM: "truecolor",
    TERM: "xterm-256color",
    TERM_PROGRAM: "devhost",
  };
}
