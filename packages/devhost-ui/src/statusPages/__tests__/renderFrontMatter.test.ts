import { expect, test } from "bun:test";
import { renderFrontMatter } from "../renderFrontMatter";

function render(value: string): ReturnType<typeof renderFrontMatter> {
  return renderFrontMatter(undefined, { type: "yaml", value });
}

test("renders a mapping as a table whose header row holds the keys and whose body row holds the values", () => {
  expect(render("title: Notes\nstatus: current\nversion: 2\ndraft: false")).toEqual({
    type: "element",
    tagName: "table",
    properties: { ariaLabel: "Front matter" },
    children: [
      {
        type: "element",
        tagName: "thead",
        properties: {},
        children: [
          {
            type: "element",
            tagName: "tr",
            properties: {},
            children: ["title", "status", "version", "draft"].map((key) => ({
              type: "element",
              tagName: "th",
              properties: {},
              children: [{ type: "text", value: key }],
            })),
          },
        ],
      },
      {
        type: "element",
        tagName: "tbody",
        properties: {},
        children: [
          {
            type: "element",
            tagName: "tr",
            properties: {},
            children: ["Notes", "current", "2", "false"].map((value) => ({
              type: "element",
              tagName: "td",
              properties: {},
              children: [{ type: "text", value }],
            })),
          },
        ],
      },
    ],
  });
});

test("keeps keys and values as text", () => {
  expect(JSON.stringify(render('"<b>key</b>": "<script>alert(1)</script>"'))).toContain(
    '{"type":"text","value":"<script>alert(1)</script>"}',
  );
});

test("leaves an empty value's cell empty and drops empty items from a joined list", () => {
  expect(JSON.stringify(render("reviewer:\ntags: [cli, null, docs]"))).toContain(
    '{"type":"element","tagName":"td","properties":{},"children":[]},{"type":"element","tagName":"td","properties":{},"children":[{"type":"text","value":"cli, docs"}]}',
  );
});

test("shows YAML that does not parse as a YAML code block", () => {
  expect(render("title: [unclosed\nstatus: current")).toEqual({
    type: "element",
    tagName: "pre",
    properties: {},
    children: [
      {
        type: "element",
        tagName: "code",
        properties: { className: ["language-yaml"] },
        children: [{ type: "text", value: "title: [unclosed\nstatus: current" }],
      },
    ],
  });
});

test("shows a block that is not a mapping as a YAML code block", () => {
  for (const value of ["- first\n- second", "just a sentence"]) {
    expect(render(value)).toMatchObject({ tagName: "pre", children: [{ children: [{ type: "text", value }] }] });
  }
});

test("shows a block whose aliases expand past the parser's limit as a YAML code block", () => {
  const value = [
    "a: &a [x, x, x, x, x, x, x, x, x, x]",
    "b: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a, *a]",
    "c: &c [*b, *b, *b, *b, *b, *b, *b, *b, *b, *b]",
    "d: [*c, *c, *c, *c, *c, *c, *c, *c, *c, *c]",
  ].join("\n");
  expect(render(value)).toMatchObject({ tagName: "pre", children: [{ children: [{ type: "text", value }] }] });
});

test("renders nothing for a block without values", () => {
  for (const value of ["", "# only a comment", "{}"]) {
    expect(render(value)).toBeUndefined();
  }
});
