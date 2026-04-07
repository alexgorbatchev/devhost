import { describe, expect, test } from "bun:test";

import { useResolvedColorScheme } from "../useResolvedColorScheme";

describe("useResolvedColorScheme", () => {
  test("is a function", () => {
    expect(typeof useResolvedColorScheme).toBe("function");
  });
});
