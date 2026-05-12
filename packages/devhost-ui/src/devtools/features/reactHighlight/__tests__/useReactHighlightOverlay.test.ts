import { describe, expect, test } from "bun:test";

import { parseReactHighlightCursorPayload } from "../reactHighlightCursorPayload";
import { useReactHighlightOverlay } from "../useReactHighlightOverlay";

describe("useReactHighlightOverlay", () => {
  test("exports the React highlight overlay hook", () => {
    expect(typeof useReactHighlightOverlay).toBe("function");
  });

  test("parses cursor payload JSON and rejects non-string data", () => {
    expect(
      parseReactHighlightCursorPayload(
        JSON.stringify({
          kind: "cursor",
          locator: "src/App.tsx:10:5",
          projectRoot: "/Users/test/project",
          stackName: "example",
          timestamp: 1,
        }),
      ),
    ).toEqual({
      kind: "cursor",
      locator: "src/App.tsx:10:5",
      projectRoot: "/Users/test/project",
      stackName: "example",
      timestamp: 1,
    });

    expect(parseReactHighlightCursorPayload({})).toBeUndefined();
    expect(parseReactHighlightCursorPayload("{")).toBeUndefined();
  });
});
