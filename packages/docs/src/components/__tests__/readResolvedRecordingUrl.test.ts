import { describe, expect, it } from "bun:test";

import { readResolvedRecordingUrl } from "../readResolvedRecordingUrl";

describe("readResolvedRecordingUrl", () => {
  it("prefixes relative replay URLs with the Astro base path", () => {
    expect(readResolvedRecordingUrl("/devhost/", "./recordings/marketing/annotation.json")).toBe(
      "/devhost/recordings/marketing/annotation.json",
    );
  });

  it("preserves explicit absolute URLs", () => {
    expect(readResolvedRecordingUrl("/devhost/", "https://cdn.example.com/annotation.json")).toBe(
      "https://cdn.example.com/annotation.json",
    );
  });

  it("preserves root-relative URLs", () => {
    expect(readResolvedRecordingUrl("/devhost/", "/devhost/recordings/marketing/annotation.json")).toBe(
      "/devhost/recordings/marketing/annotation.json",
    );
  });
});
