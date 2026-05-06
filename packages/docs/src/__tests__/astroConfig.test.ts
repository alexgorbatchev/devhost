import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

const docsPackagePath = new URL("../..", import.meta.url);

describe("astro config", () => {
  it("registers rehype-mermaid so Mermaid code fences render in docs content", () => {
    const astroConfigPath = join(docsPackagePath.pathname, "astro.config.mjs");
    const astroConfigText = readFileSync(astroConfigPath, "utf8");
    const rehypePluginsMatch = astroConfigText.match(/rehypePlugins:\s*\[[^\]]+\]/u);

    assert(rehypePluginsMatch);

    expect(astroConfigText).toContain('import rehypeMermaid from "rehype-mermaid";');
    expect(rehypePluginsMatch[0]).toContain("rehypeMermaid");
  });

  it("separates routing and devtools docs in the sidebar", () => {
    const astroConfigPath = join(docsPackagePath.pathname, "astro.config.mjs");
    const astroConfigText = readFileSync(astroConfigPath, "utf8");

    expect(astroConfigText).toContain('label: "Routing"');
    expect(astroConfigText).toContain('label: "Devtools"');
    expect(astroConfigText).not.toContain('label: "Guides"');
  });
});
