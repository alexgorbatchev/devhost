import { describe, expect, test } from "bun:test";

import { useDevtoolsTheme } from "../useDevtoolsTheme";

describe("useDevtoolsTheme", () => {
  test("is a function", () => {
    expect(typeof useDevtoolsTheme).toBe("function");
  });
});
