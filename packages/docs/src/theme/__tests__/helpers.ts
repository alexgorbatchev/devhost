import { createRenderer } from "@astrojs/starlight/expressive-code";
import type { ExpressiveCodeTheme } from "@astrojs/starlight/expressive-code";
import type { Element, Root, RootContent, Text } from "hast";

type HastNode = Root | RootContent;

export interface IRenderedToken {
  text: string;
  style: string;
}

function isElement(node: HastNode): node is Element {
  return node.type === "element";
}

function isText(node: HastNode | undefined): node is Text {
  return node?.type === "text";
}

function readChildren(node: HastNode): HastNode[] {
  return "children" in node ? node.children : [];
}

// Expressive Code emits one `<span style="--0:#RRGGBB...">text</span>` per highlighted token.
function readToken(element: Element): IRenderedToken[] {
  const [firstChild] = element.children;
  const style = element.properties.style;

  return element.tagName === "span" && isText(firstChild) && typeof style === "string"
    ? [{ text: firstChild.value, style }]
    : [];
}

function collectRenderedTokens(node: HastNode): IRenderedToken[] {
  return readChildren(node).flatMap((child) => {
    const tokens = isElement(child) ? readToken(child) : [];

    return tokens.length > 0 ? tokens : collectRenderedTokens(child);
  });
}

export async function renderTokens(
  theme: ExpressiveCodeTheme,
  code: string,
  language: string,
): Promise<IRenderedToken[]> {
  const renderer = await createRenderer({ themes: [theme] });
  const { renderedGroupAst } = await renderer.ec.render({ code, language });

  return collectRenderedTokens(renderedGroupAst);
}
