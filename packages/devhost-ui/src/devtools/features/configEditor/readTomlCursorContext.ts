import { readTomlKey, skipTomlBlanks } from "./readTomlKey";
import { scanTomlEntries } from "./scanTomlEntries";
import type { ITomlEntry, ITomlKey, ITomlScan, TomlCursorContext } from "./types";

const typedKeyPattern = /^(?:[A-Za-z0-9_-]+\s*\.\s*)*[A-Za-z0-9_-]*$/;
const typedBareValuePattern = /^[A-Za-z0-9_.:-]*$/;
const noContext: TomlCursorContext = { kind: "none" };

/**
 * Reads what the cursor at offset is typing in a TOML document: a table header, a key in the table above it, or the
 * value of a key. Only bare names and single-line values are read; anywhere else offers nothing.
 */
export function readTomlCursorContext(text: string, offset: number): TomlCursorContext {
  const lineStart: number = text.lastIndexOf("\n", offset - 1) + 1;
  const scan: ITomlScan = scanTomlEntries(text.slice(0, lineStart));

  if (scan.isValueOpen) {
    return noContext;
  }

  const contentStart: number = Math.min(skipTomlBlanks(text, lineStart), offset);
  const typed: string = text.slice(contentStart, offset);

  if (typed.startsWith("[")) {
    return readHeaderContext(typed, offset);
  }

  const tablePath: string[] = readTablePath(scan.entries);
  const equalsIndex: number = typed.indexOf("=");

  if (equalsIndex >= 0) {
    return readValueContext(text, contentStart, equalsIndex, offset, tablePath);
  }

  if (!typedKeyPattern.test(typed)) {
    return noContext;
  }

  const segments: string[] = typed.split(".").map((segment: string): string => segment.trim());
  const word: string = segments.pop() ?? "";

  return { from: offset - word.length, kind: "key", parentPath: segments, tablePath, text: word };
}

function readHeaderContext(typed: string, offset: number): TomlCursorContext {
  const name: string = typed.replace(/^\[\[?\s*/, "");

  if (!typedKeyPattern.test(name)) {
    return noContext;
  }

  const segments: string[] = name.split(".").map((segment: string): string => segment.trim());
  const word: string = segments.pop() ?? "";

  return { from: offset - word.length, kind: "header", parentPath: segments, text: word };
}

function readValueContext(
  text: string,
  contentStart: number,
  equalsIndex: number,
  offset: number,
  tablePath: string[],
): TomlCursorContext {
  const key: ITomlKey | null = readTomlKey(text, contentStart);

  if (key === null || skipTomlBlanks(text, key.to) !== contentStart + equalsIndex) {
    return noContext;
  }

  const value: string = text.slice(skipTomlBlanks(text, contentStart + equalsIndex + 1), offset);
  const keyPath: string[] = [...tablePath, ...key.segments];
  const quote: string | undefined = value[0];

  if (quote === '"' || quote === "'") {
    const word: string = value.slice(1);

    return word.includes(quote)
      ? noContext
      : { from: offset - word.length, isQuoted: true, keyPath, kind: "value", text: word };
  }

  return typedBareValuePattern.test(value)
    ? { from: offset - value.length, isQuoted: false, keyPath, kind: "value", text: value }
    : noContext;
}

function readTablePath(entries: ITomlEntry[]): string[] {
  return entries.findLast((entry: ITomlEntry): boolean => entry.kind !== "key")?.path ?? [];
}
