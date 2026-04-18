import { describe, expect, test } from "bun:test";

import { parseCommandLineArguments } from "../parseCommandLineArguments";

describe("parseCommandLineArguments", () => {
  test("parses caddy lifecycle commands", () => {
    expect(parseCommandLineArguments(["caddy", "start"])).toEqual({
      action: "start",
      kind: "caddy",
      manifestPath: null,
    });
    expect(parseCommandLineArguments(["caddy", "stop"])).toEqual({
      action: "stop",
      kind: "caddy",
      manifestPath: null,
    });
    expect(parseCommandLineArguments(["caddy", "trust"])).toEqual({
      action: "trust",
      kind: "caddy",
      manifestPath: null,
    });
    expect(parseCommandLineArguments(["caddy", "download"])).toEqual({
      action: "download",
      kind: "caddy",
      manifestPath: null,
    });
    expect(parseCommandLineArguments(["caddy", "privileged-ports"])).toEqual({
      action: "privileged-ports",
      kind: "caddy",
      manifestPath: null,
    });
  });

  test("parses caddy lifecycle commands with an explicit manifest", () => {
    expect(parseCommandLineArguments(["--manifest", "./devhost.toml", "caddy", "start"])).toEqual({
      action: "start",
      kind: "caddy",
      manifestPath: "./devhost.toml",
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
      "Expected a caddy action: start, stop, trust, download, or privileged-ports.",
    );
    expect(() => parseCommandLineArguments(["caddy", "restart"])).toThrow("Unsupported caddy action: restart");
    expect(() => parseCommandLineArguments(["caddy", "start", "now"])).toThrow(
      "Caddy commands do not accept additional arguments.",
    );
    expect(() => parseCommandLineArguments(["--manifest", "./other.toml", "caddy", "start"])).toThrow(
      "--manifest must point to a file named devhost.toml",
    );
  });

  test("rejects invalid manifest mode combinations", () => {
    expect(() => parseCommandLineArguments(["--manifest", "./other.toml"])).toThrow(
      "--manifest must point to a file named devhost.toml",
    );
    expect(() => parseCommandLineArguments(["--manifest", "./devhost.toml", "--", "bun"])).toThrow(
      "Manifest mode does not accept a child command.",
    );
    expect(() => parseCommandLineArguments(["--manifest", "./devhost.toml", "bun"])).toThrow(
      "Manifest mode does not accept a child command.",
    );
  });
});
