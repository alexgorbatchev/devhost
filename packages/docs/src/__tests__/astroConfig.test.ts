import assert from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
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

  it("renders Mermaid as inline SVG themed from the page tokens, then wraps it for scrolling", () => {
    const astroConfigPath = join(docsPackagePath.pathname, "astro.config.mjs");
    const astroConfigText = readFileSync(astroConfigPath, "utf8");
    const rehypePluginsMatch = astroConfigText.match(/rehypePlugins:\s*\[[\s\S]+?\],\n\s{2}\}/u);

    assert(rehypePluginsMatch);

    expect(rehypePluginsMatch[0].replace(/\s+/gu, " ")).toBe(
      'rehypePlugins: [ [rehypeMermaid, { strategy: "inline-svg", mermaidConfig: MERMAID_CONFIG }], rehypeWrapMermaidDiagrams, ], }',
    );
  });

  it("overrides the Starlight site title and registers the devhost code themes", () => {
    const astroConfigPath = join(docsPackagePath.pathname, "astro.config.mjs");
    const astroConfigText = readFileSync(astroConfigPath, "utf8");

    expect(astroConfigText).toContain('SiteTitle: "./src/starlight/SiteTitle.astro"');
    expect(astroConfigText).toContain(
      "themes: [createDevhostCodeTheme(DARK_CODE_THEME_PALETTE), createDevhostCodeTheme(LIGHT_CODE_THEME_PALETTE)]",
    );
  });

  it("lists every guide and architecture page in the sidebar", () => {
    const astroConfigPath = join(docsPackagePath.pathname, "astro.config.mjs");
    const astroConfigText = readFileSync(astroConfigPath, "utf8");
    const contentPath = join(docsPackagePath.pathname, "src/content/docs");
    const pageSlugs = ["guides", "architecture"].flatMap((section) =>
      readdirSync(join(contentPath, section), { recursive: true, encoding: "utf8" })
        .filter((relativePath) => relativePath.endsWith(".md"))
        .map((relativePath) => `${section}/${relativePath.replace(/\.md$/u, "")}`),
    );

    expect(pageSlugs.filter((slug) => !astroConfigText.includes(`"${slug}"`))).toEqual([]);
  });

  it("separates routing and devtools docs in the sidebar", () => {
    const astroConfigPath = join(docsPackagePath.pathname, "astro.config.mjs");
    const astroConfigText = readFileSync(astroConfigPath, "utf8");

    expect(astroConfigText).toContain('label: "Routing"');
    expect(astroConfigText).toContain('label: "Devtools"');
    expect(astroConfigText).not.toContain('label: "Guides"');
  });
});
