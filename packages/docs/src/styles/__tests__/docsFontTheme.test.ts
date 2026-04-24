import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

const stylesDirectoryPath = new URL("..", import.meta.url);
const docsPackagePath = new URL("../../..", import.meta.url);

describe("docsFontTheme", () => {
  it("registers the shared docs font theme stylesheet in the Starlight config", () => {
    const astroConfigPath = join(docsPackagePath.pathname, "astro.config.mjs");
    const astroConfigText = readFileSync(astroConfigPath, "utf8");
    const customCssMatch = astroConfigText.match(/customCss:\s*\[[^\]]+\]/u);

    assert(customCssMatch);

    expect(customCssMatch[0]).toMatchInlineSnapshot('"customCss: [\"./src/styles/docsFontTheme.css\"]"');
  });

  it("defines JetBrains Nerd Font as the global Starlight text and code font without late layout shift", () => {
    const docsFontThemePath = join(stylesDirectoryPath.pathname, "docsFontTheme.css");
    const docsFontThemeText = readFileSync(docsFontThemePath, "utf8");

    expect(docsFontThemeText).toMatchInlineSnapshot(`
"@font-face {
  font-family: \"JetBrainsMono Nerd Font\";
  font-style: normal;
  font-weight: 400;
  font-display: optional;
  src: url(\"../assets/fonts/jetbrains-mono-nerd/JetBrainsMonoNerdFont-Regular.ttf\") format(\"truetype\");
}

@font-face {
  font-family: \"JetBrainsMono Nerd Font\";
  font-style: italic;
  font-weight: 400;
  font-display: optional;
  src: url(\"../assets/fonts/jetbrains-mono-nerd/JetBrainsMonoNerdFont-Italic.ttf\") format(\"truetype\");
}

@font-face {
  font-family: \"JetBrainsMono Nerd Font\";
  font-style: normal;
  font-weight: 700;
  font-display: optional;
  src: url(\"../assets/fonts/jetbrains-mono-nerd/JetBrainsMonoNerdFont-Bold.ttf\") format(\"truetype\");
}

@font-face {
  font-family: \"JetBrainsMono Nerd Font\";
  font-style: italic;
  font-weight: 700;
  font-display: optional;
  src: url(\"../assets/fonts/jetbrains-mono-nerd/JetBrainsMonoNerdFont-BoldItalic.ttf\") format(\"truetype\");
}

:root {
  --sl-font:
    \"JetBrainsMono Nerd Font\", \"JetBrains Mono\", ui-monospace, \"SFMono-Regular\", \"Cascadia Mono\", \"Cascadia Code\",
    \"Roboto Mono\", Menlo, Consolas, \"Liberation Mono\", monospace;
  --sl-font-mono:
    \"JetBrainsMono Nerd Font\", \"JetBrains Mono\", ui-monospace, \"SFMono-Regular\", \"Cascadia Mono\", \"Cascadia Code\",
    \"Roboto Mono\", Menlo, Consolas, \"Liberation Mono\", monospace;
}
"
`);
  });
});
