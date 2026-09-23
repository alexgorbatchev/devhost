import type { RehypeMermaidOptions } from "rehype-mermaid";

export type CodeThemeType = "dark" | "light";

export type MermaidConfig = NonNullable<RehypeMermaidOptions["mermaidConfig"]>;

/**
 * The subset of the shared devhost palette that syntax themes need. Expressive Code resolves syntax colors
 * (and adjusts them for contrast) at build time, so it cannot consume the CSS custom properties directly.
 */
export interface ICodeThemePalette {
  type: CodeThemeType;
  background: string;
  foreground: string;
  muted: string;
  faint: string;
  accent: string;
  ok: string;
  warn: string;
}
