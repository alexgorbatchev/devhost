import { DESIGN_TOKENS } from "@alexgorbatchev/devhost-design";
import { createInlineSvgUrl } from "@astrojs/starlight/expressive-code";
import type { StyleOverrides } from "@astrojs/starlight/expressive-code";

import type { ICodeThemePalette, MermaidConfig } from "./types";

// Expressive Code resolves syntax colors at build time, so it takes the literal values from the shared design tokens
// rather than the `--dh-*` custom properties the rest of the site uses.
const { dark, light } = DESIGN_TOKENS.schemes;

export const DARK_CODE_THEME_PALETTE: ICodeThemePalette = {
  type: "dark",
  background: dark.termBg,
  foreground: dark.fg,
  muted: dark.fgMuted,
  faint: dark.fgFaint,
  accent: dark.accent,
  ok: dark.ok,
  warn: dark.warn,
};

export const LIGHT_CODE_THEME_PALETTE: ICodeThemePalette = {
  type: "light",
  background: light.termBg,
  foreground: light.fg,
  muted: light.fgMuted,
  faint: light.fgFaint,
  accent: light.accent,
  ok: light.ok,
  warn: light.warn,
};

// Code frames share the devtools terminal-window anatomy: header bar on surface-2, body on term-bg, 1px line borders.
// UI colors are CSS custom properties so frames follow the active data-theme; only syntax colors come from the themes.
export const CODE_STYLE_OVERRIDES: StyleOverrides = {
  borderRadius: "var(--dh-radius-md)",
  borderColor: "var(--dh-line)",
  codeFontSize: "var(--dh-doc-text-md)",
  codeLineHeight: "1.55",
  uiFontSize: "var(--dh-doc-text-sm)",
  focusBorder: "var(--dh-accent)",
  frames: {
    frameBoxShadowCssValue: "none",
    editorBackground: "var(--dh-term-bg)",
    terminalBackground: "var(--dh-term-bg)",
    editorTabBarBackground: "var(--dh-surface-2)",
    editorTabBarBorderBottomColor: "var(--dh-line)",
    editorActiveTabBackground: "var(--dh-surface-2)",
    editorActiveTabForeground: "var(--dh-fg-muted)",
    editorActiveTabBorderColor: "transparent",
    editorActiveTabIndicatorTopColor: "var(--dh-accent)",
    editorActiveTabIndicatorBottomColor: "transparent",
    terminalTitlebarBackground: "var(--dh-surface-2)",
    terminalTitlebarForeground: "var(--dh-fg-muted)",
    terminalTitlebarBorderBottomColor: "var(--dh-line)",
    terminalTitlebarDotsForeground: "var(--dh-ok)",
    terminalTitlebarDotsOpacity: "1",
    // Lucide "terminal" glyph (the devtools toolbar's terminal-session icon). src/styles/devhostContent.css resizes
    // Expressive Code's icon slot, which is otherwise a 60x16 strip sized for its three-dot default.
    terminalIcon: createInlineSvgUrl(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m4 17 6-6-6-6"/><path d="M12 19h8"/></svg>',
    ),
    inlineButtonForeground: "var(--dh-fg-muted)",
    inlineButtonBorder: "var(--dh-line)",
    tooltipSuccessBackground: "var(--dh-ok)",
    tooltipSuccessForeground: "var(--dh-surface)",
  },
};

const MERMAID_FONT_FAMILY =
  '"JetBrainsMono Nerd Font", "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const MERMAID_FONT_SIZE = 13;

// Appended by Mermaid after its own theme rules inside each diagram's scoped stylesheet, so these win. Because the
// SVG is inlined into the page, the `--dh-*` custom properties resolve against the active `data-theme`, which keeps
// diagrams in step with Starlight's theme select instead of the OS `prefers-color-scheme`.
const MERMAID_THEME_CSS = `
  rect.actor { fill: var(--dh-surface-2); stroke: var(--dh-accent); stroke-width: 1px; }
  text.actor, text.actor > tspan { fill: var(--dh-fg); font-weight: 700; }
  .actor-line { stroke: var(--dh-line); stroke-dasharray: 3 4; }
  .messageLine0, .messageLine1 { stroke: var(--dh-fg-muted); stroke-width: 1.25px; }
  .messageText { fill: var(--dh-fg); stroke: none; }
  #arrowhead path, .arrowheadPath, marker path { fill: var(--dh-fg-muted); stroke: var(--dh-fg-muted); }
  .sequenceNumber { fill: var(--dh-on-accent); }
  #sequencenumber { fill: var(--dh-accent); }
  .note { fill: var(--dh-surface-2); stroke: var(--dh-line); }
  .noteText, .noteText > tspan { fill: var(--dh-fg); }
  .labelBox { fill: var(--dh-surface-2); stroke: var(--dh-line); }
  .labelText, .labelText > tspan, .loopText, .loopText > tspan { fill: var(--dh-fg); }
  .loopLine { stroke: var(--dh-line); }
  .activation0, .activation1, .activation2 { fill: var(--dh-surface-3); stroke: var(--dh-line); }
`;

// Fonts are set in config rather than CSS because Mermaid measures text to size actor boxes and message spans.
// The top-level `fontFamily` replaces the `arial,sans-serif` default that mermaid-isomorphic injects, which would
// otherwise win over the per-diagram font settings.
export const MERMAID_CONFIG: MermaidConfig = {
  fontFamily: MERMAID_FONT_FAMILY,
  fontSize: MERMAID_FONT_SIZE,
  theme: "base",
  themeVariables: { fontFamily: MERMAID_FONT_FAMILY, fontSize: `${MERMAID_FONT_SIZE}px` },
  themeCSS: MERMAID_THEME_CSS,
  sequence: {
    actorFontFamily: MERMAID_FONT_FAMILY,
    actorFontSize: MERMAID_FONT_SIZE,
    messageFontFamily: MERMAID_FONT_FAMILY,
    messageFontSize: MERMAID_FONT_SIZE,
    noteFontFamily: MERMAID_FONT_FAMILY,
    noteFontSize: MERMAID_FONT_SIZE,
  },
};
