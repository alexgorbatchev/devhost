import { describe, expect, test } from "bun:test";

import { useTerminalSessions } from "../useTerminalSessions";

describe("useTerminalSessions", () => {
  test("is a function", () => {
    expect(typeof useTerminalSessions).toBe("function");
  });
});
