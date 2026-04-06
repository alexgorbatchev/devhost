import { describe, expect, test } from "bun:test";

import { parseCommandLineArguments } from "../parseCommandLineArguments";

describe("parseCommandLineArguments", () => {
  test("parses caddy lifecycle commands", () => {
    expect(parseCommandLineArguments(["caddy", "start"])).toEqual({
      action: "start",
      kind: "caddy",
    });
    expect(parseCommandLineArguments(["caddy", "stop"])).toEqual({
      action: "stop",
      kind: "caddy",
    });
    expect(parseCommandLineArguments(["caddy", "trust"])).toEqual({
      action: "trust",
      kind: "caddy",
    });
    expect(parseCommandLineArguments(["caddy", "download"])).toEqual({
      action: "download",
      kind: "caddy",
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

  test("rejects invalid caddy commands", () => {
    expect(() => parseCommandLineArguments(["caddy"])).toThrow(
      "Expected a caddy action: start, stop, trust, or download.",
    );
    expect(() => parseCommandLineArguments(["caddy", "restart"])).toThrow("Unsupported caddy action: restart");
    expect(() => parseCommandLineArguments(["caddy", "start", "now"])).toThrow(
      "Caddy commands do not accept additional arguments.",
    );
  });

  test("rejects invalid manifest mode combinations", () => {
    expect(() => parseCommandLineArguments(["--manifest", "./other.toml"])).toThrow(
      "--manifest must point to a file named devhost.toml",
    );
    expect(() => parseCommandLineArguments(["--manifest", "./devhost.toml", "--", "bun"])).toThrow(
      "Manifest mode does not accept a child command.",
    );
  });
});
