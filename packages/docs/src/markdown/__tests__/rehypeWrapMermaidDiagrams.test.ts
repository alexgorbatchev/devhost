import assert from "node:assert";

import { describe, expect, it } from "bun:test";
import type { Root } from "hast";
import rehypeMermaid from "rehype-mermaid";
import { unified } from "unified";

import { rehypeWrapMermaidDiagrams } from "../rehypeWrapMermaidDiagrams";

describe("rehypeWrapMermaidDiagrams", () => {
  it("wraps real rehype-mermaid inline-svg output", async () => {
    const tree: Root = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "pre",
          properties: {},
          children: [
            {
              type: "element",
              tagName: "code",
              properties: { className: ["language-mermaid"] },
              children: [{ type: "text", value: "sequenceDiagram\n  Host->>Hook: isInstalled()" }],
            },
          ],
        },
      ],
    };

    const result = await unified()
      .use(rehypeMermaid, { strategy: "inline-svg" })
      .use(rehypeWrapMermaidDiagrams)
      .run(tree);
    const figure = result.children[0];
    assert(figure?.type === "element");
    const scroll = figure.children[0];
    assert(scroll?.type === "element");
    const svg = scroll.children[0];
    assert(svg?.type === "element");
    const viewBox = svg.properties.viewBox;
    assert(typeof viewBox === "string");

    expect([figure.tagName, figure.properties.className]).toEqual(["figure", ["dh-diagram", "not-content"]]);
    expect(scroll.properties.ariaLabel).toBe("sequence diagram");
    expect(svg.properties.width).toBe(viewBox.split(" ")[2]);
  }, 60_000);

  it("wraps a rendered Mermaid SVG in a keyboard-scrollable figure at the diagram's natural width", () => {
    const tree: Root = {
      type: "root",
      children: [
        { type: "element", tagName: "p", properties: {}, children: [{ type: "text", value: "Intro" }] },
        {
          type: "element",
          tagName: "svg",
          properties: {
            id: "mermaid-0",
            width: "100%",
            viewBox: "-50 -10 1234 567",
            ariaRoleDescription: ["sequence"],
          },
          children: [],
        },
      ],
    };

    rehypeWrapMermaidDiagrams()(tree);

    expect(tree).toEqual({
      type: "root",
      children: [
        { type: "element", tagName: "p", properties: {}, children: [{ type: "text", value: "Intro" }] },
        {
          type: "element",
          tagName: "figure",
          properties: { className: ["dh-diagram", "not-content"] },
          children: [
            {
              type: "element",
              tagName: "div",
              properties: {
                className: ["dh-diagram-scroll"],
                tabIndex: 0,
                role: "region",
                ariaLabel: "sequence diagram",
              },
              children: [
                {
                  type: "element",
                  tagName: "svg",
                  properties: {
                    id: "mermaid-0",
                    width: "1234",
                    viewBox: "-50 -10 1234 567",
                    ariaRoleDescription: ["sequence"],
                  },
                  children: [],
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it("wraps diagrams nested inside other elements", () => {
    const tree: Root = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "section",
          properties: {},
          children: [
            {
              type: "element",
              tagName: "svg",
              properties: { width: "100%", viewBox: "0 0 300 200", ariaRoleDescription: ["flowchart-v2"] },
              children: [],
            },
          ],
        },
      ],
    };

    rehypeWrapMermaidDiagrams()(tree);

    expect(tree).toEqual({
      type: "root",
      children: [
        {
          type: "element",
          tagName: "section",
          properties: {},
          children: [
            {
              type: "element",
              tagName: "figure",
              properties: { className: ["dh-diagram", "not-content"] },
              children: [
                {
                  type: "element",
                  tagName: "div",
                  properties: {
                    className: ["dh-diagram-scroll"],
                    tabIndex: 0,
                    role: "region",
                    ariaLabel: "flowchart-v2 diagram",
                  },
                  children: [
                    {
                      type: "element",
                      tagName: "svg",
                      properties: { width: "300", viewBox: "0 0 300 200", ariaRoleDescription: ["flowchart-v2"] },
                      children: [],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it("leaves SVGs that are not Mermaid output untouched", () => {
    const tree: Root = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "svg",
          properties: { width: "16", viewBox: "0 0 24 24" },
          children: [],
        },
      ],
    };

    rehypeWrapMermaidDiagrams()(tree);

    expect(tree).toEqual({
      type: "root",
      children: [
        {
          type: "element",
          tagName: "svg",
          properties: { width: "16", viewBox: "0 0 24 24" },
          children: [],
        },
      ],
    });
  });
});
