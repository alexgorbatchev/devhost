interface ITomlParseErrorPositionCandidate {
  line?: unknown;
}

interface ITomlParseErrorCandidate {
  message?: unknown;
  position?: ITomlParseErrorPositionCandidate;
}

interface ITomlTableDeclaration {
  header: string;
  line: number;
}

export async function readManifest(manifestPath: string): Promise<unknown> {
  const manifestText: string = await Bun.file(manifestPath).text();

  try {
    return Bun.TOML.parse(manifestText);
  } catch (error: unknown) {
    const message: string = formatManifestParseError(manifestText, error);
    throw new Error(`Failed to parse ${manifestPath}: ${message}`);
  }
}

function formatManifestParseError(manifestText: string, error: unknown): string {
  const duplicateTableMessage: string | null = getDuplicateTableMessage(manifestText, error);
  if (duplicateTableMessage !== null) {
    return duplicateTableMessage;
  }

  const candidate: ITomlParseErrorCandidate = getTomlParseErrorCandidate(error);
  if (typeof candidate.message === "string") {
    return candidate.message;
  }

  return String(error);
}

function getDuplicateTableMessage(manifestText: string, error: unknown): string | null {
  const candidate = getTomlParseErrorCandidate(error);
  if (typeof candidate.message !== "string" || !candidate.message.startsWith("Cannot redefine key '")) {
    return null;
  }

  const positionLine: number | undefined = getTomlErrorLine(candidate);
  if (positionLine === undefined) {
    return null;
  }

  const lines: string[] = manifestText.split(/\r?\n/u);
  const currentTable = findNearestTableDeclaration(lines, positionLine);
  if (currentTable === null) {
    return null;
  }

  const originalTable = findPreviousTableDeclaration(lines, currentTable);
  if (originalTable === null) {
    return null;
  }

  return `TOML table ${currentTable.header} is declared more than once (lines ${originalTable.line} and ${currentTable.line}). Merge those settings into a single table instead of repeating the header.`;
}

function getTomlErrorLine(candidate: ITomlParseErrorCandidate): number | undefined {
  if (typeof candidate.position?.line === "number") {
    return candidate.position.line;
  }

  return undefined;
}

function getTomlParseErrorCandidate(error: unknown): ITomlParseErrorCandidate {
  if (typeof error !== "object" || error === null) {
    return {};
  }

  const message: unknown = Reflect.get(error, "message");
  const positionCandidate: unknown = Reflect.get(error, "position");

  if (typeof positionCandidate !== "object" || positionCandidate === null) {
    return { message };
  }

  return {
    message,
    position: {
      line: Reflect.get(positionCandidate, "line"),
    },
  };
}

function findNearestTableDeclaration(lines: string[], startLine: number): ITomlTableDeclaration | null {
  for (let lineNumber = Math.min(startLine, lines.length); lineNumber >= 1; lineNumber -= 1) {
    const header: string | null = parseTomlTableHeader(lines[lineNumber - 1]);
    if (header !== null) {
      return {
        header,
        line: lineNumber,
      };
    }
  }

  return null;
}

function findPreviousTableDeclaration(lines: string[], table: ITomlTableDeclaration): ITomlTableDeclaration | null {
  for (let lineNumber = table.line - 1; lineNumber >= 1; lineNumber -= 1) {
    const header: string | null = parseTomlTableHeader(lines[lineNumber - 1]);
    if (header === table.header) {
      return {
        header,
        line: lineNumber,
      };
    }
  }

  return null;
}

function parseTomlTableHeader(line: string): string | null {
  const trimmedLine: string = line.trim();
  const match: RegExpMatchArray | null = trimmedLine.match(/^\[([^\]]+)\](?:\s+#.*)?$/u);

  return match?.[0] ?? null;
}
