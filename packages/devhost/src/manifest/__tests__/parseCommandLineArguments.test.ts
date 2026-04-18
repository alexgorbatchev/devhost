import { describe, expect, test } from "bun:test";

import { parseCommandLineArguments } from "../parseCommandLineArguments";

describe("parseCommandLineArguments", () => {
  test("parses caddy lifecycle commands", () => {
    expect(parseCommandLineArguments(["caddy", "start"])).toEqual({
      action: "start",
      kind: "caddy-lifecycle",
      manifestPath: null,
    });
    expect(parseCommandLineArguments(["caddy", "stop"])).toEqual({
      action: "stop",
      kind: "caddy-lifecycle",
      manifestPath: null,
    });
    expect(parseCommandLineArguments(["caddy", "trust"])).toEqual({
      action: "trust",
      kind: "caddy-lifecycle",
      manifestPath: null,
    });
    expect(parseCommandLineArguments(["caddy", "download"])).toEqual({
      action: "download",
      kind: "caddy-lifecycle",
      manifestPath: null,
    });
    expect(parseCommandLineArguments(["caddy", "privileged-ports"])).toEqual({
      action: "privileged-ports",
      kind: "caddy-lifecycle",
      manifestPath: null,
    });
  });

  test("parses caddy lifecycle commands with an explicit manifest", () => {
    expect(parseCommandLineArguments(["--manifest", "./devhost.toml", "caddy", "start"])).toEqual({
      action: "start",
      kind: "caddy-lifecycle",
      manifestPath: "./devhost.toml",
    });
  });

  test("parses non-lifecycle caddy commands", () => {
    expect(parseCommandLineArguments(["caddy", "print-root-cert"])).toEqual({
      kind: "caddy-print-root-cert",
    });
    expect(parseCommandLineArguments(["caddy", "trust-remote", "devbox"])).toEqual({
      kind: "caddy-trust-remote",
      sshTarget: "devbox",
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
      "Expected a caddy action: start, stop, trust, download, privileged-ports, print-root-cert, or trust-remote.",
    );
    expect(() => parseCommandLineArguments(["caddy", "restart"])).toThrow("Unsupported caddy action: restart");
    expect(() => parseCommandLineArguments(["caddy", "start", "now"])).toThrow(
      "Caddy lifecycle commands do not accept additional arguments.",
    );
    expect(() => parseCommandLineArguments(["--manifest", "./other.toml", "caddy", "start"])).toThrow(
      "--manifest must point to a file named devhost.toml",
    );
    expect(() => parseCommandLineArguments(["caddy", "trust-remote"])).toThrow(
      "Expected an SSH target. Example: devhost caddy trust-remote devbox",
    );
    expect(() => parseCommandLineArguments(["caddy", "trust-remote", "devbox", "extra"])).toThrow(
      "The caddy trust-remote command accepts exactly one SSH target.",
    );
    expect(() =>
      parseCommandLineArguments(["--manifest", "./devhost.toml", "caddy", "trust-remote", "devbox"]),
    ).toThrow("The caddy trust-remote command does not accept --manifest.");
    expect(() => parseCommandLineArguments(["caddy", "print-root-cert", "now"])).toThrow(
      "The caddy print-root-cert command does not accept additional arguments.",
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
