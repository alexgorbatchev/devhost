import { expect, it } from "bun:test";
import { readGuideTitle } from "../readGuideTitle";

it("reads a guide's title from its frontmatter", () => {
  const markdown =
    '---\ntitle: "Managed Caddy and routing"\ndescription: "Route services."\n---\n\ntitle: "Not this one"\n';

  expect(readGuideTitle(markdown)).toBe("Managed Caddy and routing");
});

it("reads a title written without quotes", () => {
  expect(readGuideTitle("---\ntitle: Stack lifecycle\n---\n\nProse.\n")).toBe("Stack lifecycle");
});

it.each([
  ["no frontmatter", "# Heading\n\ntitle: Body text\n"],
  ["frontmatter without a title", '---\ndescription: "Route services."\n---\n\nProse.\n'],
])("rejects a guide with %s", (_name, markdown) => {
  expect(() => readGuideTitle(markdown)).toThrow("The guide has no title in its frontmatter");
});
