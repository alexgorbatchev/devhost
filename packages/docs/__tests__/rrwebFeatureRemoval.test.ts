import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";

interface IPackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

const docsPackagePath: string = path.resolve(import.meta.dir, "..");
const removedFeaturePaths: readonly string[] = [
  "scripts/recordMarketingDemos.ts",
  "src/components/CaptureRouteStatusSurface.tsx",
  "src/components/CaptureSourceCardSurface.tsx",
  "src/components/MarketingRecordingPlayer.astro",
  "src/components/readResolvedRecordingUrl.ts",
  "src/components/registerMarketingRecordingPlayerLifecycle.ts",
  "src/components/rewriteRrwebRecordingAssetUrls.ts",
  "src/pages/[captureRoute].astro",
  "src/recordings/createRrwebDemoRecording.ts",
  "src/recordings/marketingRecordingScenarios.ts",
  "src/recordings/types.ts",
  "src/scripts/createMockTerminalSessionScreen.ts",
  "src/scripts/devhostCaptureDemo.ts",
  "public/__devhost__/xterm.css",
  "public/cursors/default.svg",
  "public/cursors/handpointing.svg",
  "public/recordings/marketing/.gitkeep",
  "public/recordings/marketing/annotation.json",
  "public/recordings/marketing/overlay.json",
  "public/recordings/marketing/routing-health.json",
  "public/recordings/marketing/sessions.json",
  "public/recordings/marketing/source-jumps.json",
];

describe("docs rrweb feature removal", () => {
  it("removes the rrweb feature files from the docs package", () => {
    expect(
      removedFeaturePaths.map((relativePath: string): boolean => {
        return fs.existsSync(path.join(docsPackagePath, relativePath));
      }),
    ).toEqual(Array.from({ length: removedFeaturePaths.length }, (): boolean => false));
  });

  it("removes rrweb recorder dependencies and scripts from package.json", () => {
    const packageJson: IPackageJson = JSON.parse(fs.readFileSync(path.join(docsPackagePath, "package.json"), "utf8"));

    expect(packageJson.scripts?.["record:marketing"]).toBeUndefined();
    expect(packageJson.dependencies?.["@rrweb/all"]).toBeUndefined();
    expect(packageJson.dependencies?.["rrweb-player"]).toBeUndefined();
    expect(packageJson.devDependencies?.["@rrweb/types"]).toBeUndefined();
  });

  it("stops injecting rrweb playback into the generated landing page", () => {
    const syncSource: string = fs.readFileSync(path.join(docsPackagePath, "sync.ts"), "utf8");

    expect(syncSource.includes("MarketingRecordingPlayer")).toBe(false);
    expect(syncSource.includes("marketingRecordingScenarios")).toBe(false);
    expect(syncSource.includes("recordings/marketing")).toBe(false);
  });
});
