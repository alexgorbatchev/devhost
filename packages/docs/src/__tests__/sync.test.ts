import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

const docsPackagePath = new URL("../..", import.meta.url);

describe("docs sync script", () => {
  it("keeps guides and architecture docs inside the docs workspace", () => {
    const syncScriptPath = join(docsPackagePath.pathname, "sync.ts");
    const syncScriptText = readFileSync(syncScriptPath, "utf8");

    expect(syncScriptText).not.toContain("apps/devhost/docs/guides");
    expect(syncScriptText).not.toContain("apps/devhost/docs/architecture");
    expect(syncScriptText).not.toContain("fs.rmSync(directoryPath, { recursive: true, force: true })");
  });
});
