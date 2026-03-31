import { describe, expect, test } from "bun:test";

import { createLogPreviewRange } from "../devtools/createLogPreviewRange";

describe("createLogPreviewRange", () => {
  test("returns a centered preview range when enough context exists", () => {
    expect(createLogPreviewRange(30, 15)).toEqual({
      endIndex: 26,
      startIndex: 5,
    });
  });

  test("clips the preview range at the list boundaries", () => {
    expect(createLogPreviewRange(5, 0)).toEqual({
      endIndex: 5,
      startIndex: 0,
    });
  });

  test("returns null for invalid targets", () => {
    expect(createLogPreviewRange(0, 0)).toBeNull();
    expect(createLogPreviewRange(5, -1)).toBeNull();
    expect(createLogPreviewRange(5, 5)).toBeNull();
  });
});
