const agentStatusPrefix = "\u001b]1337;SetAgentStatus=working\u0007";
const clearScreenSequence = "\u001b[3J\u001b[2J\u001b[H";
const terminalWidthColumns = 120;
const terminalHeightRows = 24;

type EditorScreenVariant = "default" | "relative-number";

interface ICreateMockAgentTerminalSessionScreenOptions {
  comment: string;
  displayName: string;
  kind: "agent";
  markerCount: number;
  title: string;
}

interface ICreateMockCommandTerminalSessionScreenOptions {
  comment: string;
  displayName: string;
  kind: "command";
  markerCount: number;
  title: string;
}

interface ICreateMockEditorTerminalSessionScreenOptions {
  componentName: string;
  kind: "editor";
  sourceLabel: string;
  variant: EditorScreenVariant;
}

type CreateMockTerminalSessionScreenOptions =
  | ICreateMockAgentTerminalSessionScreenOptions
  | ICreateMockCommandTerminalSessionScreenOptions
  | ICreateMockEditorTerminalSessionScreenOptions;

export function createMockTerminalSessionScreen(options: CreateMockTerminalSessionScreenOptions): string {
  if (options.kind === "agent") {
    return `${agentStatusPrefix}${clearScreenSequence}${joinTerminalLines(createAgentTerminalSessionLines(options))}`;
  }

  if (options.kind === "command") {
    return `${clearScreenSequence}${joinTerminalLines(createCommandTerminalSessionLines(options))}`;
  }

  return `${clearScreenSequence}${joinTerminalLines(createEditorTerminalSessionLines(options))}`;
}

function createAgentTerminalSessionLines(options: ICreateMockAgentTerminalSessionScreenOptions): readonly string[] {
  return createSizedTerminalLines([
    `${options.displayName} · agent session                                                          Working…`,
    "",
    `Reviewing the annotation handoff for ${options.title}.`,
    "",
    "Selected markers",
    `  1. Primary target · launch command rail · marker count ${options.markerCount}`,
    "  2. Secondary target · worker-service warning alignment",
    "",
    "Draft",
    `  Title: ${options.title}`,
    `  Comment: ${truncateText(options.comment, terminalWidthColumns - 11)}`,
    "",
    "Plan",
    "  [1/3] Verify the selected markers map to distinct DOM targets.",
    "  [2/3] Refresh the marketing replay artifacts.",
    "  [3/3] Validate cursor transitions and annotation previews.",
    "",
    "Recent notes",
    "  - Agent status hook is active for the tray preview.",
    "  - Secondary annotation is queued for submission.",
    "  - Waiting for the next capture instruction.",
    "",
    "~/devhost/docs-demo $",
    "",
  ]);
}

function createCommandTerminalSessionLines(options: ICreateMockCommandTerminalSessionScreenOptions): readonly string[] {
  return createSizedTerminalLines([
    `${options.displayName} · annotation command                                                   Connected`,
    "",
    "$ devhost annotate --apply --static-preview",
    "",
    `Title: ${options.title}`,
    `Markers: ${options.markerCount}`,
    `Comment: ${truncateText(options.comment, terminalWidthColumns - 10)}`,
    "",
    "Queued output",
    "  - Preparing rrweb refresh inputs",
    "  - Regenerating marketing capture artifacts",
    "  - Capturing static terminal previews",
    "",
    "stdout",
    "  annotation preview prepared",
    "  source-jumps preview prepared",
    "  terminal sessions preview prepared",
    "",
    "Next",
    "  Submit the refreshed capture when validation passes.",
    "",
    "~/devhost/docs-demo $",
    "",
    "",
  ]);
}

function createEditorTerminalSessionLines(options: ICreateMockEditorTerminalSessionScreenOptions): readonly string[] {
  const sourceFileName = readSourceFileName(options.sourceLabel);
  const codeLines = createEditorCodeLines(options.componentName, options.variant);
  const statusLine =
    options.variant === "relative-number"
      ? `NORMAL  ${sourceFileName} [+]                               relativenumber                        12:5`
      : `NORMAL  ${sourceFileName} [+]                                     utf-8                           12:5`;
  const commandLine = options.variant === "relative-number" ? ":set relativenumber" : "";

  return createSizedTerminalLines([
    `Neovim · ${sourceFileName}`,
    options.sourceLabel,
    "",
    ...codeLines,
    "",
    statusLine,
    commandLine,
  ]);
}

function createEditorCodeLines(componentName: string, variant: EditorScreenVariant): readonly string[] {
  const lineNumbers =
    variant === "relative-number"
      ? ["11", "10", "9", "8", "7", "6", "5", "4", "3", "2", "1", "12", "1", "2", "3", "4"]
      : ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16"];
  const code = [
    'import { css } from "@emotion/css";',
    'import type { JSX } from "react";',
    "",
    `const ${componentName}ClassName = css({`,
    '  display: "grid",',
    '  gap: "12px",',
    '  padding: "16px",',
    '  borderRadius: "18px",',
    "});",
    "",
    `export function ${componentName}(): JSX.Element {`,
    '  return <section data-testid="CaptureSourceContent">',
    "    <CaptureSourceCard className={captureCardClassName} />",
    "  </section>;",
    "}",
    "",
  ];

  return code.map((line: string, index: number): string => {
    return `${lineNumbers[index]} `.padStart(4, " ") + line;
  });
}

function createSizedTerminalLines(lines: readonly string[]): readonly string[] {
  const clampedLines = lines.slice(0, terminalHeightRows);

  if (clampedLines.length === terminalHeightRows) {
    return clampedLines.map((line: string): string => padText(line, terminalWidthColumns));
  }

  return Array.from({ length: terminalHeightRows }, (_entry: unknown, index: number): string => {
    return padText(clampedLines[index] ?? "", terminalWidthColumns);
  });
}

function readSourceFileName(sourceLabel: string): string {
  const sourceSegments = sourceLabel.split(":");
  const filePath = sourceSegments[0] ?? sourceLabel;
  const pathSegments = filePath.split("/");

  return pathSegments[pathSegments.length - 1] ?? filePath;
}

function padText(content: string, width: number): string {
  return content.padEnd(width, " ").slice(0, width);
}

function truncateText(content: string, width: number): string {
  return content.length <= width ? content : `${content.slice(0, Math.max(0, width - 1))}…`;
}

function joinTerminalLines(lines: readonly string[]): string {
  return `${lines.join("\r\n")}\r\n`;
}
