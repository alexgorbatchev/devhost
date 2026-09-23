import { describe, expect, test } from "bun:test";

import { useRetainedValue } from "../useRetainedValue";

describe("useRetainedValue", () => {
  test("is exported as a hook", () => {
    expect(typeof useRetainedValue).toBe("function");
  });
});
