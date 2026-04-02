import { describe, expect, test } from "bun:test";

import { resolveManagedCaddyBindDirective } from "../resolveManagedCaddyBindDirective";

describe("resolveManagedCaddyBindDirective", () => {
  test("omits the bind directive on macOS so rootless Caddy can open :443", () => {
    expect(resolveManagedCaddyBindDirective("darwin")).toBeNull();
  });

  test("keeps loopback-only binding on non-macOS platforms", () => {
    expect(resolveManagedCaddyBindDirective("linux")).toBe("    default_bind 127.0.0.1 [::1]");
    expect(resolveManagedCaddyBindDirective("win32")).toBe("    default_bind 127.0.0.1 [::1]");
  });
});
