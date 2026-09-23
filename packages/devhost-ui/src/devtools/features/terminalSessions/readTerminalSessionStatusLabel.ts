import type { TerminalSessionStatus } from "./types";

const terminalSessionStatusLabels: Record<TerminalSessionStatus, string> = {
  connecting: "connecting",
  disconnected: "disconnected",
  error: "error",
  exited: "finished",
  idle: "idle",
  running: "running",
  working: "working",
};

export function readTerminalSessionStatusLabel(status: TerminalSessionStatus): string {
  return terminalSessionStatusLabels[status];
}
