import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

const docsPackagePath = new URL("../../..", import.meta.url);

describe("docsFontTheme", () => {
  it("registers the shared docs font theme stylesheet in the Starlight config", () => {
    const astroConfigPath = join(docsPackagePath.pathname, "astro.config.mjs");
    const astroConfigText = readFileSync(astroConfigPath, "utf8");
    const customCssMatch = astroConfigText.match(/customCss:\s*\[[^\]]+\]/u);

    assert(customCssMatch);

    expect(customCssMatch[0]).toMatchInlineSnapshot('"customCss: ["./src/styles/docsFontTheme.css"]"');
  });
});
