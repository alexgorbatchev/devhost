import { describe, expect, test } from "bun:test";

import { useDevtoolsColorScheme } from "../useDevtoolsColorScheme";

describe("useDevtoolsColorScheme", () => {
  test("is exported as a hook", () => {
    expect(typeof useDevtoolsColorScheme).toBe("function");
  });
});
