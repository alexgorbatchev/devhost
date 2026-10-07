import assert from "node:assert/strict";
import type { IGuideTerminalStep } from "./types";

export function createGuideTape(steps: readonly IGuideTerminalStep[]): string {
  const lines = [
    'Output "raw/guide.mp4"',
    'Output "terminal.ascii"',
    "Require devhost",
    "Require curl",
    "Require clear",
    'Set Shell "bash"',
    "Set Width 1280",
    "Set Height 720",
    "Set FontSize 22",
    'Set FontFamily "DejaVu Sans Mono, Noto Color Emoji"',
    "Set Padding 24",
    "Set Framerate 30",
    "Set CursorBlink false",
    "Set TypingSpeed 35ms",
    'Env AGENT "0"',
    "Hide",
    "Type@0ms \"export PS1='> '; set -o pipefail\"",
    "Enter",
    "Wait+Line@5s />$/",
    "Ctrl+L",
    "Sleep 300ms",
    "Show",
  ];
  for (const [index, step] of steps.entries()) {
    if (index > 0) lines.push("Hide", 'Type@0ms "clear"', "Enter", "Wait+Line@5s /^>$/", "Sleep 300ms", "Show");
    assert(!/[`\n\r]/.test(step.command), "Command cannot contain a tape delimiter or newline");
    lines.push(
      `Type \`${step.command}\``,
      "Enter",
      `Wait+${step.waitPattern === "^>$" ? "Line" : "Screen"}@30s /${step.waitPattern.replaceAll("/", "\\/")}/`,
    );
    if (step.shouldWaitForStack) {
      lines.push(
        "Hide",
        'Type@0ms "bun waitGuideReady.ts"',
        "Enter",
        "Wait+Screen@30s /(?m)^GUIDE_READY/",
        "Ctrl+L",
        "Sleep 300ms",
        "Show",
      );
    } else {
      lines.push(`Sleep ${step.holdMs ?? 1_000}ms`);
    }
  }
  lines.push('Screenshot "terminal.png"', "Sleep 300ms");
  return lines.join("\n") + "\n";
}
