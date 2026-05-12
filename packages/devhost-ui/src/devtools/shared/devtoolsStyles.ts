import devtoolsCssText from "./devtools.css?inline";

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

  return stylesheet;
}

function readDevtoolsCssText(): string {
  const viteStylesheet: HTMLStyleElement | undefined = Array.from(
    document.querySelectorAll<HTMLStyleElement>("style[data-vite-dev-id]"),
  ).find((stylesheet: HTMLStyleElement): boolean => {
    return stylesheet.getAttribute("data-vite-dev-id")?.endsWith(devtoolsStylesheetViteSourcePathSuffix) ?? false;
  });

  return viteStylesheet?.textContent ?? devtoolsCssText;
}
