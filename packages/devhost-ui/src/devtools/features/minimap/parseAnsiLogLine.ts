import Anser from "anser";

export interface ILogAnsiFragment {
  backgroundColor: string | null;
  foregroundColor: string | null;
  isBold: boolean;
  isDim: boolean;
  isItalic: boolean;
  isStrikethrough: boolean;
  isUnderline: boolean;
  text: string;
}

export interface IParsedAnsiLogLine {
  fragments: ILogAnsiFragment[];
  text: string;
}

export function parseAnsiLogLine(line: string): IParsedAnsiLogLine {
  const segments: Anser.AnserJsonEntry[] = Anser.ansiToJson(line, { remove_empty: true });
  const parsedLine: IParsedAnsiLogLine = {
    fragments: [],
    text: "",
  };

  for (const segment of segments) {
    const fragment: ILogAnsiFragment = createAnsiFragment(segment);

    appendAnsiFragment(parsedLine, fragment);
    parsedLine.text += fragment.text;
  }

  return parsedLine;
}

function createAnsiFragment(segment: Anser.AnserJsonEntry): ILogAnsiFragment {
  const decorations: Anser.DecorationName[] = segment.decorations ?? [];

  return {
    backgroundColor: resolveAnsiColor(segment.bg_truecolor || segment.bg),
    foregroundColor: resolveAnsiColor(segment.fg_truecolor || segment.fg),
    isBold: decorations.includes("bold"),
    isDim: decorations.includes("dim"),
    isItalic: decorations.includes("italic"),
    isStrikethrough: decorations.includes("strikethrough"),
    isUnderline: decorations.includes("underline"),
    text: segment.content,
  };
}

function appendAnsiFragment(parsedLine: IParsedAnsiLogLine, fragment: ILogAnsiFragment): void {
  if (fragment.text.length === 0) {
    return;
  }

  const previousFragment: ILogAnsiFragment | undefined = parsedLine.fragments.at(-1);

  if (previousFragment !== undefined && areAnsiFragmentsEquivalent(previousFragment, fragment)) {
    previousFragment.text += fragment.text;
    return;
  }

  parsedLine.fragments.push(fragment);
}

function areAnsiFragmentsEquivalent(left: ILogAnsiFragment, right: ILogAnsiFragment): boolean {
  return (
    left.backgroundColor === right.backgroundColor &&
    left.foregroundColor === right.foregroundColor &&
    left.isBold === right.isBold &&
    left.isDim === right.isDim &&
    left.isItalic === right.isItalic &&
    left.isStrikethrough === right.isStrikethrough &&
    left.isUnderline === right.isUnderline
  );
}

function resolveAnsiColor(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmedValue: string = value.trim();

  if (trimmedValue.length === 0) {
    return null;
  }

  return trimmedValue.includes(",") ? `rgb(${trimmedValue})` : trimmedValue;
}
