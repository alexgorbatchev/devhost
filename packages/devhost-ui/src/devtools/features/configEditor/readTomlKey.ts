import type { ITomlKey, ITomlText } from "./types";

const bareKeyPattern = /[A-Za-z0-9_-]+/y;
const basicEscapes: Record<string, string> = { '"': '"', "\\": "\\", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };

/** Reads a dotted key at position, or returns null when there is none. */
export function readTomlKey(text: string, position: number): ITomlKey | null {
  const segments: string[] = [];
  let segmentPosition: number = position;

  for (;;) {
    const segment = readSimpleKey(text, segmentPosition);

    if (segment === null) {
      return null;
    }

    segments.push(segment.value);

    const nextPosition: number = skipTomlBlanks(text, segment.end);

    if (text[nextPosition] !== ".") {
      return { from: position, segments, to: segment.end };
    }

    segmentPosition = skipTomlBlanks(text, nextPosition + 1);
  }
}

function readSimpleKey(text: string, position: number): ITomlText | null {
  const quote: string | undefined = text[position];

  if (quote === '"' || quote === "'") {
    return readQuotedKey(text, position, quote);
  }

  bareKeyPattern.lastIndex = position;
  const match: RegExpExecArray | null = bareKeyPattern.exec(text);

  return match === null ? null : { end: position + match[0].length, value: match[0] };
}

function readQuotedKey(text: string, position: number, quote: string): ITomlText | null {
  let value: string = "";

  for (let index: number = position + 1; index < text.length; index += 1) {
    const character: string | undefined = text[index];

    if (character === "\n") {
      return null;
    }

    if (character === quote) {
      return { end: index + 1, value };
    }

    if (quote === '"' && character === "\\") {
      const escape = readBasicEscape(text, index);

      if (escape === null) {
        return null;
      }

      value += escape.value;
      index = escape.end - 1;
      continue;
    }

    value += character;
  }

  return null;
}

function readBasicEscape(text: string, position: number): ITomlText | null {
  const marker: string | undefined = text[position + 1];

  if (marker !== undefined && marker in basicEscapes) {
    return { end: position + 2, value: basicEscapes[marker] ?? "" };
  }

  const digits: number = marker === "u" ? 4 : marker === "U" ? 8 : 0;
  const codePoint: number = Number.parseInt(text.slice(position + 2, position + 2 + digits), 16);

  if (digits === 0 || Number.isNaN(codePoint) || codePoint > 0x10ffff) {
    return null;
  }

  return { end: position + 2 + digits, value: String.fromCodePoint(codePoint) };
}

/** Skips the spaces and tabs at position. */
export function skipTomlBlanks(text: string, position: number): number {
  let index: number = position;

  while (text[index] === " " || text[index] === "\t") {
    index += 1;
  }

  return index;
}
