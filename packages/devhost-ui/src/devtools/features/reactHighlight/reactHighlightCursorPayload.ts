export function parseReactHighlightCursorPayload(data: unknown): unknown {
  if (typeof data !== "string") {
    return undefined;
  }

  try {
    return JSON.parse(data);
  } catch {
    return undefined;
  }
}
