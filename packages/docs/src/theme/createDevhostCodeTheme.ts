import { ExpressiveCodeTheme } from "@astrojs/starlight/expressive-code";

import type { ICodeThemePalette } from "./types";

/**
 * Syntax colors come only from the shared status tokens, matching the docs design reference: sections and keywords
 * in accent, strings in ok, literals in warn, keys in foreground, punctuation muted, comments faint.
 */
export function createDevhostCodeTheme(palette: ICodeThemePalette): ExpressiveCodeTheme {
  return new ExpressiveCodeTheme({
    name: `devhost-${palette.type}`,
    type: palette.type,
    colors: {
      "editor.background": palette.background,
      "editor.foreground": palette.foreground,
    },
    settings: [
      { settings: { foreground: palette.foreground } },
      {
        scope: ["comment", "punctuation.definition.comment"],
        settings: { foreground: palette.faint, fontStyle: "italic" },
      },
      { scope: ["string", "punctuation.definition.string"], settings: { foreground: palette.ok } },
      {
        scope: ["constant.numeric", "constant.language", "constant.other", "constant.character"],
        settings: { foreground: palette.warn },
      },
      { scope: ["keyword", "storage"], settings: { foreground: palette.accent } },
      {
        scope: ["entity.name.section", "entity.name.tag"],
        settings: { foreground: palette.accent, fontStyle: "bold" },
      },
      { scope: ["punctuation", "meta.brace", "keyword.operator"], settings: { foreground: palette.muted } },
      {
        scope: [
          "variable",
          "variable.other.key",
          "support.type.property-name",
          "entity.other.attribute-name",
          "meta.object-literal.key",
        ],
        settings: { foreground: palette.foreground },
      },
    ],
  });
}
