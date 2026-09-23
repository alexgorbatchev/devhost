import type { Element, Root } from "hast";

import type { HastTreeTransformer } from "./types";

type HastParent = Root | Element;

// `aria-roledescription` is a space-separated attribute, so hast stores it as a token list (e.g. `["sequence"]`).
function readRoleDescription(element: Element): string | undefined {
  const roleDescription = element.properties.ariaRoleDescription;

  return Array.isArray(roleDescription) && roleDescription.length > 0 ? roleDescription.join(" ") : undefined;
}

function isMermaidSvg(element: Element): boolean {
  return element.tagName === "svg" && readRoleDescription(element) !== undefined;
}

function readViewBoxWidth(svg: Element): string | undefined {
  const viewBox = svg.properties.viewBox;
  const width = typeof viewBox === "string" ? viewBox.trim().split(/[\s,]+/u)[2] : undefined;

  return width === undefined || Number.isNaN(Number(width)) ? undefined : width;
}

function wrapDiagram(svg: Element): Element {
  const naturalWidth = readViewBoxWidth(svg);

  return {
    type: "element",
    tagName: "figure",
    properties: { className: ["dh-diagram", "not-content"] },
    children: [
      {
        type: "element",
        tagName: "div",
        properties: {
          className: ["dh-diagram-scroll"],
          // Wide diagrams scroll instead of shrinking; the scroll region must be reachable by keyboard.
          tabIndex: 0,
          role: "region",
          ariaLabel: `${readRoleDescription(svg)} diagram`,
        },
        children: [
          naturalWidth === undefined ? svg : { ...svg, properties: { ...svg.properties, width: naturalWidth } },
        ],
      },
    ],
  };
}

function wrapChildren(parent: HastParent): void {
  parent.children.forEach((child, index) => {
    if (child.type !== "element") {
      return;
    }
    if (isMermaidSvg(child)) {
      parent.children[index] = wrapDiagram(child);
      return;
    }
    wrapChildren(child);
  });
}

/**
 * Runs after `rehype-mermaid` (inline-svg strategy). Mermaid emits `width="100%"`, which shrinks wide diagrams until
 * their text is unreadable; this pins each diagram to its viewBox width inside a horizontally scrollable figure.
 */
export function rehypeWrapMermaidDiagrams(): HastTreeTransformer {
  return (tree: Root): void => {
    wrapChildren(tree);
  };
}
