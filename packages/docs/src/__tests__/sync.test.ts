import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

const docsPackagePath = new URL("../..", import.meta.url);

describe("docs sync script", () => {
  it("writes the landing page from the README and the favicon", () => {
    const syncResult = Bun.spawnSync(["bun", "sync.ts"], {
      cwd: docsPackagePath.pathname,
      stderr: "pipe",
      stdout: "pipe",
    });

    expect(syncResult.exitCode).toBe(0);

    const landingPagePath = join(docsPackagePath.pathname, "src/content/docs/index.mdx");
    const landingPageText = readFileSync(landingPagePath, "utf8");

    expect(landingPageText).toStartWith("---\n");
    const readmeText = readFileSync(join(docsPackagePath.pathname, "../../apps/devhost/README.md"), "utf8");
    const firstSection = readmeText.split("\n").find((line) => line.startsWith("## "));
    expect(firstSection).toBeDefined();
    expect(landingPageText).toContain(`${firstSection}\n`);
    expect(readFileSync(join(docsPackagePath.pathname, "public/favicon.svg"), "utf8")).toStartWith("<svg ");
  });
});
