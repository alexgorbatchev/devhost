import { describe, expect, test } from "bun:test";

import { useAnnotationSelectionDraft } from "../useAnnotationSelectionDraft";

describe("useAnnotationSelectionDraft", () => {
  test("is a function", () => {
    expect(typeof useAnnotationSelectionDraft).toBe("function");
  });
});
