import { describe, expect, test } from "bun:test";

import { useComponentSourceNavigation } from "../useComponentSourceNavigation";

describe("useComponentSourceNavigation", () => {
  test("is a function", () => {
    expect(typeof useComponentSourceNavigation).toBe("function");
  });
});
