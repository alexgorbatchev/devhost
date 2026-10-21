import { scanTomlEntries } from "./scanTomlEntries";
import type { IConfigDiagnostic, IConfigIssue, ITextRange, ITomlEntry } from "./types";

/**
 * Places each issue in the text of the file at filePath: a syntax error at its line and column, a validation issue
 * at the key or table it names, or the deepest table above a key that is missing. An issue in another file, or one
 * that names no place, marks the start of the file.
 */
export function readConfigDiagnostics(issues: IConfigIssue[], text: string, filePath: string): IConfigDiagnostic[] {
  const entries: ITomlEntry[] = scanTomlEntries(text).entries;

  return issues.map((issue: IConfigIssue): IConfigDiagnostic => {
    if (issue.path !== undefined && issue.path !== filePath) {
      return { from: 0, message: issue.message, to: 0 };
    }

    if (issue.line !== undefined) {
      return { message: issue.message, ...readLineRange(text, issue.line, issue.column ?? 1) };
    }

    const entry: ITomlEntry | undefined = issue.keyPath === undefined ? undefined : findEntry(entries, issue.keyPath);

    return entry === undefined
      ? { from: 0, message: issue.message, to: 0 }
      : { from: entry.from, message: issue.message, to: entry.to };
  });
}

function readLineRange(text: string, line: number, column: number): ITextRange {
  let lineStart: number = 0;

  for (let current: number = 1; current < line; current += 1) {
    const lineEnd: number = text.indexOf("\n", lineStart);

    if (lineEnd === -1) {
      break;
    }

    lineStart = lineEnd + 1;
  }

  const nextLineBreak: number = text.indexOf("\n", lineStart);
  const lineEnd: number = nextLineBreak === -1 ? text.length : nextLineBreak;
  const from: number = Math.min(lineStart + Math.max(0, column - 1), lineEnd);

  return { from, to: Math.min(from + 1, lineEnd) };
}

function findEntry(entries: ITomlEntry[], keyPath: string): ITomlEntry | undefined {
  const segments: string[] = keyPath.split(".");
  let deepest: ITomlEntry | undefined;

  for (const entry of entries) {
    const isPrefix: boolean =
      entry.path.length <= segments.length && entry.path.every((segment, index) => segment === segments[index]);

    if (isPrefix && (deepest === undefined || entry.path.length > deepest.path.length)) {
      deepest = entry;
    }
  }

  return deepest;
}
