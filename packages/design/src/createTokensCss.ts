import { MARK_TOKEN_NAMES, SCHEME_TOKEN_NAMES, SHAPE_TOKEN_NAMES } from "./constants";
import type { IDesignTokens } from "./types";

// Dark is the default everywhere: documents (`:root`), the devtools Shadow DOM (`:host`), and dialog backdrops, which
// do not reliably inherit custom properties. Light applies wherever `data-theme="light"` is set, on the document
// root, a wrapper element, or the shadow host.
const DARK_SELECTORS = [":root", ":host", "::backdrop"];
const LIGHT_SELECTORS = ['[data-theme="light"]', '[data-theme="light"] ::backdrop', ':host([data-theme="light"])'];

function renderDeclarations<K extends string>(values: Record<K, string>, names: Record<K, string>): string[] {
  const declarations: string[] = [];
  for (const key in names) {
    declarations.push(`  ${names[key]}: ${values[key]};`);
  }
  return declarations;
}

function renderRule(selectors: string[], declarations: string[]): string {
  return `${selectors.join(",\n")} {\n${declarations.join("\n")}\n}\n`;
}

export function createTokensCss(tokens: IDesignTokens): string {
  const header =
    "/* Generated from packages/design/src/constants.ts by `just design write-tokens`. " + "Do not edit. */\n";

  return [
    header,
    renderRule(DARK_SELECTORS, [
      ...renderDeclarations(tokens.shape, SHAPE_TOKEN_NAMES),
      ...renderDeclarations(tokens.marks, MARK_TOKEN_NAMES),
      ...renderDeclarations(tokens.schemes.dark, SCHEME_TOKEN_NAMES),
    ]),
    renderRule(LIGHT_SELECTORS, renderDeclarations(tokens.schemes.light, SCHEME_TOKEN_NAMES)),
  ].join("\n");
}
