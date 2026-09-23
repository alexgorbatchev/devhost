import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

const docsPackagePath = new URL("../../..", import.meta.url);

describe("docsFontTheme", () => {
  it("registers the font, shared token, docs token, chrome, and content stylesheets in cascade order in the Starlight config", () => {
    const astroConfigPath = join(docsPackagePath.pathname, "astro.config.mjs");
    const astroConfigText = readFileSync(astroConfigPath, "utf8");
    const customCssMatch = astroConfigText.match(/customCss:\s*\[[^\]]+\]/u);

    assert(customCssMatch);

    expect(customCssMatch[0].replace(/\s+/gu, " ")).toBe(
      'customCss: [ "./src/styles/docsFontTheme.css", "@alexgorbatchev/devhost-design/tokens.css", "./src/styles/devhostTokens.css", "./src/styles/devhostChrome.css", "./src/styles/devhostContent.css", ]',
    );
  });
});
