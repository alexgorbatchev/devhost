import { describe, expect, test } from "bun:test";

import { useServiceLogs } from "../useServiceLogs";

describe("useServiceLogs", () => {
  test("is a function", () => {
    expect(typeof useServiceLogs).toBe("function");
  });
});
