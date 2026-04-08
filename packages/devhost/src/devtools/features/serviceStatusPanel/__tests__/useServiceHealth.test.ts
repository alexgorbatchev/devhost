import { describe, expect, test } from "bun:test";

import { useServiceHealth } from "../useServiceHealth";

describe("useServiceHealth", () => {
  test("is a function", () => {
    expect(typeof useServiceHealth).toBe("function");
  });
});
