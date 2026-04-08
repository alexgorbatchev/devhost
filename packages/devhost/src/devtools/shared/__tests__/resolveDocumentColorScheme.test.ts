import { describe, expect, test } from "bun:test";

import { resolveDocumentColorScheme } from "../resolveDocumentColorScheme";

describe("resolveDocumentColorScheme", () => {
  test("returns the explicit dark color scheme when computed style is dark", () => {
    expect(resolveDocumentColorScheme("dark", false)).toBe("dark");
    expect(resolveDocumentColorScheme("only dark", false)).toBe("dark");
  });

  test("returns the explicit light color scheme when computed style is light", () => {
    expect(resolveDocumentColorScheme("light", true)).toBe("light");
    expect(resolveDocumentColorScheme("only light", true)).toBe("light");
  });

  test("falls back to the user preference when computed style allows both schemes", () => {
    expect(resolveDocumentColorScheme("light dark", true)).toBe("dark");
    expect(resolveDocumentColorScheme("light dark", false)).toBe("light");
  });

  test("falls back to the user preference when computed style is not explicit", () => {
    expect(resolveDocumentColorScheme("normal", true)).toBe("dark");
    expect(resolveDocumentColorScheme("", false)).toBe("light");
  });
});
