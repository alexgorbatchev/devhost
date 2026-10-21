import { readTomlKey, skipTomlBlanks } from "./readTomlKey";
import type { ITomlEntry, ITomlKey, ITomlScan } from "./types";

interface ITomlHeader extends ITomlKey {
  isArray: boolean;
}

interface ISkippedText {
  end: number;
  /** The line breaks inside the skipped text. */
  lines: number;
  isOpen: boolean;
}

// Separates path segments in map keys; TOML names cannot contain it unescaped.
const pathSeparator = "\u0000";

/**
 * Reads the tables and keys of a TOML document line by line. Unlike a parser it reads documents that are being typed:
 * a line that is not a complete key or header is skipped, and the rest of the document is still read.
 */
export function scanTomlEntries(text: string): ITomlScan {
  const entries: ITomlEntry[] = [];
  const arrayIndexes = new Map<string, number>();
  let tablePath: string[] = [];
  let position: number = 0;
  let line: number = 1;

  while (position < text.length) {
    position = skipTomlBlanks(text, position);
    const character: string | undefined = text[position];

    if (character === undefined) {
      break;
    }

    if (character === "\n") {
      line += 1;
      position += 1;
      continue;
    }

    if (character === "[") {
      const header: ITomlHeader | null = readHeader(text, position);

      if (header !== null) {
        tablePath = resolveTablePath(header, arrayIndexes);
        entries.push({
          from: header.from,
          kind: header.isArray ? "arrayTable" : "table",
          line,
          path: tablePath,
          to: header.to,
        });
      }

      position = findLineEnd(text, position);
      continue;
    }

    const key: ITomlKey | null = character === "#" ? null : readTomlKey(text, position);
    const equalsPosition: number = key === null ? -1 : skipTomlBlanks(text, key.to);

    if (key === null || text[equalsPosition] !== "=") {
      position = findLineEnd(text, position);
      continue;
    }

    entries.push({ from: key.from, kind: "key", line, path: [...tablePath, ...key.segments], to: key.to });

    const value: ISkippedText = skipValue(text, equalsPosition + 1);

    if (value.isOpen) {
      return { entries, isValueOpen: true };
    }

    line += value.lines;
    position = value.end;
  }

  return { entries, isValueOpen: false };
}

function resolveTablePath(header: ITomlHeader, arrayIndexes: Map<string, number>): string[] {
  return header.segments.map((segment: string, index: number): string => {
    const plainPath: string = header.segments.slice(0, index + 1).join(pathSeparator);

    if (header.isArray && index === header.segments.length - 1) {
      const elementIndex: number = (arrayIndexes.get(plainPath) ?? -1) + 1;

      // Arrays of tables inside the previous element belong to that element.
      for (const nestedPath of arrayIndexes.keys()) {
        if (nestedPath.startsWith(plainPath + pathSeparator)) {
          arrayIndexes.delete(nestedPath);
        }
      }

      arrayIndexes.set(plainPath, elementIndex);
      return `${segment}[${elementIndex}]`;
    }

    const elementIndex: number | undefined = arrayIndexes.get(plainPath);

    return elementIndex === undefined ? segment : `${segment}[${elementIndex}]`;
  });
}

function readHeader(text: string, position: number): ITomlHeader | null {
  const isArray: boolean = text[position + 1] === "[";
  const key: ITomlKey | null = readTomlKey(text, skipTomlBlanks(text, position + (isArray ? 2 : 1)));

  if (key === null || !text.startsWith(isArray ? "]]" : "]", skipTomlBlanks(text, key.to))) {
    return null;
  }

  return { ...key, isArray };
}

function skipValue(text: string, position: number): ISkippedText {
  let depth: number = 0;
  let lines: number = 0;
  let index: number = position;

  while (index < text.length) {
    const character: string | undefined = text[index];

    if (character === '"' || character === "'") {
      const skipped: ISkippedText = skipString(text, index, character);

      lines += skipped.lines;

      if (skipped.isOpen) {
        return { end: text.length, isOpen: true, lines };
      }

      index = skipped.end;
      continue;
    }

    if (character === "#") {
      index = findLineEnd(text, index);
      continue;
    }

    if (character === "\n") {
      if (depth === 0) {
        return { end: index, isOpen: false, lines };
      }

      lines += 1;
    } else if (character === "[" || character === "{") {
      depth += 1;
    } else if (character === "]" || character === "}") {
      depth = Math.max(0, depth - 1);
    }

    index += 1;
  }

  return { end: text.length, isOpen: depth > 0, lines };
}

function skipString(text: string, position: number, quote: string): ISkippedText {
  const delimiter: string = quote.repeat(3);
  const isMultiline: boolean = text.startsWith(delimiter, position);
  let lines: number = 0;

  for (let index: number = position + (isMultiline ? 3 : 1); index < text.length; index += 1) {
    const character: string | undefined = text[index];

    if (quote === '"' && character === "\\") {
      index += 1;
      lines += text[index] === "\n" ? 1 : 0;
      continue;
    }

    if (character === "\n") {
      if (!isMultiline) {
        // An unterminated single-line string ends with its line.
        return { end: index, isOpen: false, lines };
      }

      lines += 1;
      continue;
    }

    if (!isMultiline && character === quote) {
      return { end: index + 1, isOpen: false, lines };
    }

    if (isMultiline && text.startsWith(delimiter, index)) {
      let end: number = index + 3;

      // Up to two quotes before the closing delimiter belong to the string.
      while (end < index + 5 && text[end] === quote) {
        end += 1;
      }

      return { end, isOpen: false, lines };
    }
  }

  return { end: text.length, isOpen: isMultiline, lines };
}

function findLineEnd(text: string, position: number): number {
  const lineEnd: number = text.indexOf("\n", position);

  return lineEnd === -1 ? text.length : lineEnd;
}
