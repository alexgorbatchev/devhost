import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";

import type { ISourceLocation } from "./sourceLocation";

const sourceTextCache: Map<string, Promise<string | null>> = new Map();
const traceMapCache: Map<string, Promise<TraceMap | null>> = new Map();
const sourceMapAnnotationPrefix: string = "sourceMappingURL=";

export async function symbolicateSourceLocation(
  sourceLocation: ISourceLocation,
): Promise<ISourceLocation | undefined> {
  if (!isLikelyGeneratedJavaScriptPath(sourceLocation.fileName)) {
    return undefined;
  }

  const sourceUrl: string | undefined = resolveFetchableSourceUrl(sourceLocation.fileName);

  if (sourceUrl === undefined) {
    return undefined;
  }

  const traceMap: TraceMap | null = await getTraceMap(sourceUrl);

  if (traceMap === null) {
    return undefined;
  }

  const originalMapping = originalPositionFor(traceMap, {
    column: normalizeGeneratedColumn(sourceLocation.columnNumber),
    line: sourceLocation.lineNumber,
  });

  if (originalMapping.source === null || originalMapping.line === null || originalMapping.column === null) {
    return undefined;
  }

  return {
    columnNumber: originalMapping.column + 1,
    componentName: sourceLocation.componentName ?? originalMapping.name ?? undefined,
    fileName: originalMapping.source,
    lineNumber: originalMapping.line,
  };
}

async function getTraceMap(sourceUrl: string): Promise<TraceMap | null> {
  const cachedTraceMap: Promise<TraceMap | null> | undefined = traceMapCache.get(sourceUrl);

  if (cachedTraceMap !== undefined) {
    return cachedTraceMap;
  }

  const traceMapPromise: Promise<TraceMap | null> = createTraceMap(sourceUrl);
  traceMapCache.set(sourceUrl, traceMapPromise);
  return traceMapPromise;
}

async function createTraceMap(sourceUrl: string): Promise<TraceMap | null> {
  const sourceText: string | null = await fetchText(sourceUrl);

  if (sourceText === null) {
    return null;
  }

  const sourceMapUrl: string | undefined = extractSourceMapUrl(sourceText, sourceUrl);

  if (sourceMapUrl === undefined) {
    return null;
  }

  const sourceMapText: string | null = await fetchText(sourceMapUrl);

  if (sourceMapText === null) {
    return null;
  }

  try {
    return new TraceMap(sourceMapText, sourceMapUrl);
  } catch {
    return null;
  }
}

async function fetchText(url: string): Promise<string | null> {
  const cachedSourceText: Promise<string | null> | undefined = sourceTextCache.get(url);

  if (cachedSourceText !== undefined) {
    return cachedSourceText;
  }

  const sourceTextPromise: Promise<string | null> = fetchTextFromUrl(url);
  sourceTextCache.set(url, sourceTextPromise);
  return sourceTextPromise;
}

async function fetchTextFromUrl(url: string): Promise<string | null> {
  try {
    const response: Response = await fetch(url);

    if (!response.ok) {
      return null;
    }

    return await response.text();
  } catch {
    return null;
  }
}

function extractSourceMapUrl(sourceText: string, sourceUrl: string): string | undefined {
  const sourceLines: string[] = sourceText.split(/\r?\n/);

  for (let lineIndex: number = sourceLines.length - 1; lineIndex >= 0; lineIndex -= 1) {
    const sourceLine: string = sourceLines[lineIndex].trim();

    if (sourceLine.length === 0) {
      continue;
    }

    if (!sourceLine.startsWith("//#") && !sourceLine.startsWith("//@")) {
      break;
    }

    const sourceMappingUrlIndex: number = sourceLine.indexOf(sourceMapAnnotationPrefix);

    if (sourceMappingUrlIndex === -1) {
      continue;
    }

    const sourceMapSpecifier: string = sourceLine.slice(sourceMappingUrlIndex + sourceMapAnnotationPrefix.length);

    return resolveSourceMapUrl(sourceMapSpecifier, sourceUrl);
  }

  return undefined;
}

function resolveFetchableSourceUrl(rawFileName: string): string | undefined {
  const directUrl: string | undefined = tryParseAbsoluteSourceUrl(rawFileName);

  if (directUrl !== undefined) {
    return directUrl;
  }

  if (looksLikeUnsupportedAbsoluteSpecifier(rawFileName) || typeof window !== "object") {
    return undefined;
  }

  if (rawFileName.startsWith("./") || rawFileName.startsWith("../")) {
    return new URL(rawFileName, window.location.href).toString();
  }

  if (rawFileName.startsWith("/")) {
    return new URL(rawFileName, window.location.origin).toString();
  }

  return new URL(`/${rawFileName.replace(/^\/+/, "")}`, window.location.origin).toString();
}

function normalizeGeneratedColumn(columnNumber: number | undefined): number {
  return Math.max((columnNumber ?? 1) - 1, 0);
}

function isLikelyGeneratedJavaScriptPath(fileName: string): boolean {
  return /\.(?:[cm]?js|jsx)$/i.test(fileName.replace(/[?#].*$/, ""));
}

function resolveSourceMapUrl(sourceMapSpecifier: string, sourceUrl: string): string | undefined {
  try {
    return new URL(sourceMapSpecifier, sourceUrl).toString();
  } catch {
    return tryParseAbsoluteSourceUrl(sourceMapSpecifier);
  }
}

function tryParseAbsoluteSourceUrl(rawUrl: string): string | undefined {
  try {
    const parsedUrl = new URL(rawUrl);

    return isSupportedSourceProtocol(parsedUrl.protocol) ? parsedUrl.toString() : undefined;
  } catch {
    return undefined;
  }
}

function isSupportedSourceProtocol(protocol: string): boolean {
  return protocol === "file:" || protocol === "http:" || protocol === "https:" || protocol === "data:";
}

function looksLikeUnsupportedAbsoluteSpecifier(rawUrl: string): boolean {
  return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(rawUrl);
}
