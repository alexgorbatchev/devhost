import { describe, expect, test } from "bun:test";

import { parseCommandLineArguments } from "../parseCommandLineArguments";

describe("parseCommandLineArguments", () => {
  test("parses single-service mode", () => {
    expect(parseCommandLineArguments(["--host", "hello.local.test", "--port", "3200", "--", "bun", "run", "dev"]))
      .toEqual({
        command: ["bun", "run", "dev"],
        host: "hello.local.test",
        kind: "single-service",
        port: 3200,
      });
  });

  test("parses implicit manifest mode", () => {
    expect(parseCommandLineArguments([])).toEqual({
      kind: "manifest",
      manifestPath: null,
    });
  });

  test("parses explicit manifest mode", () => {
    expect(parseCommandLineArguments(["--manifest", "./devhost.toml"])).toEqual({
      kind: "manifest",
      manifestPath: "./devhost.toml",
    });
  });

  test("rejects invalid single-service input", () => {
    expect(() => parseCommandLineArguments(["--host", "bad host", "--port", "3200", "--", "bun"]))
      .toThrow("Host must be a valid hostname");
    expect(() => parseCommandLineArguments(["--port", "3200"])).toThrow("--port requires --host.");
    expect(() => parseCommandLineArguments(["--host", "hello.local.test", "--port", "0", "--", "bun"]))
      .toThrow("Port must be a valid TCP port");
  });

  test("rejects invalid manifest mode combinations", () => {
    expect(() => parseCommandLineArguments(["--manifest", "./other.toml"])).toThrow(
      "--manifest must point to a file named devhost.toml",
    );
    expect(() => parseCommandLineArguments(["--manifest", "./devhost.toml", "--", "bun"])).toThrow(
      "Manifest mode does not accept a child command.",
    );
    expect(() => parseCommandLineArguments(["--host", "hello.local.test", "--manifest", "./devhost.toml"])).toThrow(
      "--manifest and --host are mutually exclusive.",
    );
  });
});
