import { describe, expect, test } from "bun:test";

import { useToolbarPopoverId } from "../useToolbarPopoverId";

describe("useToolbarPopoverId", () => {
  test("is exported as a hook", () => {
    expect(typeof useToolbarPopoverId).toBe("function");
  });
});
