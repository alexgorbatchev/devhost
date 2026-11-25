import { describe, expect, it } from "bun:test";
import { readRustReleaseVersion } from "../buildRelease";

describe("Rust release metadata", () => {
  it("uses authoritative app metadata and accepts its exact release tag", () => {
    expect(readRustReleaseVersion({ name: "devhost", version: "0.0.19" }, "v0.0.19")).toBe("0.0.19");
    expect(readRustReleaseVersion({ name: "devhost", version: "0.0.19" })).toBe("0.0.19");
  });

  it("rejects a mismatched tag rather than silently mislabelling an archive", () => {
    expect(() => readRustReleaseVersion({ name: "devhost", version: "0.0.19" }, "v0.0.18")).toThrow(
      "Release tag v0.0.18 does not match metadata version v0.0.19.",
    );
  });

  it.each([
    null,
    {},
    { name: "other", version: "0.0.19" },
    { name: "devhost", version: "dev" },
    { name: "devhost", version: "../bad" },
    { name: "devhost", version: "01.0.0" },
  ])("rejects invalid production metadata %j", (metadata) => {
    expect(() => readRustReleaseVersion(metadata)).toThrow(
      "Expected devhost release metadata with a stable semantic version.",
    );
  });
});
