import { expect, test } from "bun:test";
import { resolveChromeForTestingPlatform } from "../resolveChromeForTestingPlatform";

test("names the Chrome for Testing download and executable of each supported platform", () => {
  expect(resolveChromeForTestingPlatform("darwin", "arm64")).toEqual({
    name: "mac-arm64",
    executablePath: "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  });
  expect(resolveChromeForTestingPlatform("darwin", "x64")).toEqual({
    name: "mac-x64",
    executablePath: "chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  });
  expect(resolveChromeForTestingPlatform("linux", "x64")).toEqual({
    name: "linux64",
    executablePath: "chrome-linux64/chrome",
  });
});

test("rejects a platform Chrome for Testing publishes no build for", () => {
  expect(() => resolveChromeForTestingPlatform("linux", "arm64")).toThrow(
    "Chrome for Testing publishes no build for linux arm64",
  );
});
