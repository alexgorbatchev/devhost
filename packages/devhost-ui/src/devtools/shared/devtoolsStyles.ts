import {
  createShadowRootPropertyFallbackCssText,
  type IRegisteredCustomProperty,
} from "./createShadowRootPropertyFallbackCssText";
import devtoolsCssText from "./devtoolsCssText";

const devtoolsStylesheetAttributeName: string = "data-devhost-devtools-styles";
const devtoolsStylesheetViteSourcePathSuffix: string = "/src/devtools/shared/devtools.css";

type DevtoolsStyleRoot = Document | ShadowRoot;
type DevtoolsStyleContainer = DevtoolsStyleRoot | HTMLElement;

export function installDevtoolsStyles(root: DevtoolsStyleRoot): HTMLStyleElement {
  const stylesheetRoot: DevtoolsStyleContainer = root instanceof Document ? root.head : root;
  const existingStylesheet: HTMLStyleElement | null = stylesheetRoot.querySelector(
    `style[${devtoolsStylesheetAttributeName}]`,
  );

  if (existingStylesheet !== null) {
    return existingStylesheet;
  }

  const stylesheet: HTMLStyleElement = document.createElement("style");
  stylesheet.setAttribute(devtoolsStylesheetAttributeName, "");
  stylesheet.textContent = readDevtoolsCssText();
  stylesheetRoot.prepend(stylesheet);

  if (!(root instanceof Document)) {
    installShadowRootPropertyFallback(stylesheet);
  }

  return stylesheet;
}

// `@property` rules are ignored inside shadow roots; restate their initial values so Tailwind's `--tw-*` variables
// (border style, shadows, rings, transforms) resolve. Browsers without CSSPropertyRule also lack `@property`, where
// Tailwind's own `@supports`-gated fallback already applies.
function installShadowRootPropertyFallback(stylesheet: HTMLStyleElement): void {
  const sheet: CSSStyleSheet | null = stylesheet.sheet;

  if (sheet === null || typeof CSSPropertyRule === "undefined") {
    return;
  }

  const registeredProperties: IRegisteredCustomProperty[] = Array.from(sheet.cssRules)
    .filter(isCssPropertyRule)
    .map((rule: CSSPropertyRule): IRegisteredCustomProperty => {
      return { inherits: rule.inherits, initialValue: rule.initialValue, name: rule.name };
    });
  const fallbackCssText: string = createShadowRootPropertyFallbackCssText(registeredProperties);

  if (fallbackCssText.length > 0) {
    sheet.insertRule(fallbackCssText, sheet.cssRules.length);
  }
}

// Structural check instead of `instanceof`, so rules from another realm (for example an iframe document) match too.
function isCssPropertyRule(rule: CSSRule): rule is CSSPropertyRule {
  return "inherits" in rule && "initialValue" in rule && "name" in rule && "syntax" in rule;
}

function readDevtoolsCssText(): string {
  const viteStylesheet: HTMLStyleElement | undefined = Array.from(
    document.querySelectorAll<HTMLStyleElement>("style[data-vite-dev-id]"),
  ).find((stylesheet: HTMLStyleElement): boolean => {
    return stylesheet.getAttribute("data-vite-dev-id")?.endsWith(devtoolsStylesheetViteSourcePathSuffix) ?? false;
  });

  return viteStylesheet?.textContent ?? devtoolsCssText;
}
