import { expect, test } from "bun:test";
import { selectChromeForTestingRelease } from "../selectChromeForTestingRelease";

// The shape of last-known-good-versions-with-downloads.json, cut to two channels.
const listing = {
  timestamp: "2026-10-20T10:00:00.000Z",
  channels: {
    Stable: {
      channel: "Stable",
      version: "155.0.8059.84",
      revision: "1500000",
      downloads: {
        chrome: [
          { platform: "linux64", url: "https://storage.example/155.0.8059.84/linux64/chrome-linux64.zip" },
          { platform: "mac-arm64", url: "https://storage.example/155.0.8059.84/mac-arm64/chrome-mac-arm64.zip" },
        ],
      },
    },
    Beta: {
      channel: "Beta",
      version: "157.0.8103.6",
      revision: "1510000",
      downloads: {
        chrome: [{ platform: "mac-arm64", url: "https://storage.example/157.0.8103.6/mac-arm64/chrome-mac-arm64.zip" }],
      },
    },
  },
};

test("selects the current Stable build for the platform", () => {
  expect(selectChromeForTestingRelease(listing, "mac-arm64")).toEqual({
    version: "155.0.8059.84",
    url: "https://storage.example/155.0.8059.84/mac-arm64/chrome-mac-arm64.zip",
  });
});

test("fails when the Stable release has no download for the platform", () => {
  expect(() => selectChromeForTestingRelease(listing, "mac-x64")).toThrow(
    "Chrome for Testing Stable 155.0.8059.84 has no chrome download for mac-x64",
  );
});
