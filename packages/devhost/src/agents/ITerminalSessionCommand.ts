export interface ITerminalSessionCommand {
  cleanup: () => void;
  command: string[];
  cwd: string;
  env: Record<string, string>;
}
