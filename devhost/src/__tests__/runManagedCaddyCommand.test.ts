import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { managedCaddyPaths } from "../caddyPaths";
import {
  createManagedCaddyCommandArguments,
  createManagedCaddyCommandErrorMessage,
  resolveCaddyExecutablePath,
} from "../runManagedCaddyCommand";

describe("runManagedCaddyCommand", () => {
  test("resolveCaddyExecutablePath returns isolated path if it exists", () => {
    managedCaddyPaths.caddyDirectoryPath = "mock-exists";
    const result = resolveCaddyExecutablePath((path: string): boolean => path.includes("mock-exists"), "darwin");
    expect(result).toBe(join("mock-exists", "caddy"));
  });

  test("resolveCaddyExecutablePath falls back to global caddy if isolated binary does not exist", () => {
    managedCaddyPaths.caddyDirectoryPath = "mock-missing";
    const result = resolveCaddyExecutablePath((): boolean => false);
    expect(result).toBe("caddy");
  });

  test("createManagedCaddyCommandArguments appends correct config options", () => {
    const args = ["start"];
    const result = createManagedCaddyCommandArguments(args);
    expect(result).toEqual(["start", "--config", managedCaddyPaths.caddyfilePath, "--adapter", "caddyfile"]);
  });

  describe("createManagedCaddyCommandErrorMessage", () => {
    test("returns base message when outputs are empty", () => {
      const result = createManagedCaddyCommandErrorMessage("start", {
        stderr: new Uint8Array(),
        stdout: new Uint8Array(),
        success: false,
      });
      expect(result).toBe("Caddy start failed.");
    });

    test("includes decoded stdout and stderr when present", () => {
      const stderr = new TextEncoder().encode("some error\n");
      const stdout = new TextEncoder().encode("some output\n");
      const result = createManagedCaddyCommandErrorMessage("stop", {
        stderr,
        stdout,
        success: false,
      });
      expect(result).toBe("Caddy stop failed.\nsome error\nsome output");
    });
  });
});
