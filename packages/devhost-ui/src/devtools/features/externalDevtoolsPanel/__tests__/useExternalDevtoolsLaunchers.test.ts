import { describe, expect, test } from "bun:test";

import { useExternalDevtoolsLaunchers } from "../useExternalDevtoolsLaunchers";

describe("useExternalDevtoolsLaunchers", () => {
  test("is a function", () => {
    expect(typeof useExternalDevtoolsLaunchers).toBe("function");
  });
});
