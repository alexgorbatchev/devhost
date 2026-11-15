import type { Element, ElementContent, Text } from "hast";
import type { Yaml } from "mdast";
import { parseDocument } from "yaml";

type FrontMatterEntry = [key: string, value: unknown];
type TableCellTagName = "td" | "th";

/**
 * Renders the YAML front matter block that `remark-frontmatter` parses at the start of a Markdown document the way
 * GitHub does: a table whose header row holds the keys and whose body row holds the values. A nested mapping becomes
 * a nested table, a list of plain values is joined with commas, and a list that holds mappings or lists shows one cell
 * per item. A block that is not a valid YAML mapping is shown as a YAML code block, and a block without values renders
 * nothing. Keys and values are always text, never markup.
 *
 * It is a `mdast-util-to-hast` handler for `yaml` nodes, which that library otherwise drops.
 */
export function renderFrontMatter(_state: unknown, node: Yaml): Element | undefined {
  let data: unknown;
  try {
    data = parseFrontMatter(node.value);
  } catch {
    return createCodeBlock(node.value);
  }
  if (data === null || data === undefined) {
    return undefined;
  }
  if (!isMapping(data)) {
    return createCodeBlock(node.value);
  }
  const entries = Object.entries(data);
  return entries.length ? createTable(entries, { ariaLabel: "Front matter" }) : undefined;
}

/** Parses the block, throwing on YAML errors and on aliases that expand past the parser's resource limit. */
function parseFrontMatter(source: string): unknown {
  const document = parseDocument(source);
  const [error] = document.errors;
  if (error) {
    throw error;
  }
  return document.toJS();
}

function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}

function isCollection(value: unknown): boolean {
  return Array.isArray(value) || isMapping(value);
}

function renderValue(value: unknown): ElementContent[] {
  if (value === null || value === undefined) {
    return [];
  }
  if (isMapping(value)) {
    return [createTable(Object.entries(value), {})];
  }
  if (!Array.isArray(value)) {
    return [createText(String(value))];
  }
  if (value.some(isCollection)) {
    return [createElement("table", {}, [createElement("tbody", {}, [createRow("td", value.map(renderValue))])])];
  }
  const items = value.filter((item) => item !== null && item !== undefined).map(String);
  return items.length ? [createText(items.join(", "))] : [];
}

function createTable(entries: FrontMatterEntry[], properties: Element["properties"]): Element {
  return createElement("table", properties, [
    createElement("thead", {}, [
      createRow(
        "th",
        entries.map(([key]) => [createText(key)]),
      ),
    ]),
    createElement("tbody", {}, [
      createRow(
        "td",
        entries.map(([, value]) => renderValue(value)),
      ),
    ]),
  ]);
}

function createRow(cellTagName: TableCellTagName, cells: ElementContent[][]): Element {
  return createElement(
    "tr",
    {},
    cells.map((children) => createElement(cellTagName, {}, children)),
  );
}

function createCodeBlock(source: string): Element {
  return createElement("pre", {}, [createElement("code", { className: ["language-yaml"] }, [createText(source)])]);
}

function createElement(tagName: string, properties: Element["properties"], children: ElementContent[]): Element {
  return { type: "element", tagName, properties, children };
}

function createText(value: string): Text {
  return { type: "text", value };
}
