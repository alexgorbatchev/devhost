import type { IChromeForTestingPlatform } from "./types";

const macExecutablePath = "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";

// Chrome for Testing's platform names and the executable inside each platform's archive, as its downloads list them.
export function resolveChromeForTestingPlatform(platform: NodeJS.Platform, arch: string): IChromeForTestingPlatform {
  if (platform === "darwin" && arch === "arm64") {
    return { name: "mac-arm64", executablePath: `chrome-mac-arm64/${macExecutablePath}` };
  }
  if (platform === "darwin" && arch === "x64") {
    return { name: "mac-x64", executablePath: `chrome-mac-x64/${macExecutablePath}` };
  }
  if (platform === "linux" && arch === "x64") {
    return { name: "linux64", executablePath: "chrome-linux64/chrome" };
  }
  throw new Error(`Chrome for Testing publishes no build for ${platform} ${arch}`);
}
