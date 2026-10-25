import { expect, it } from "bun:test";
import { readSiteUrls } from "../readSiteUrls";

const siteUrl = "https://example.test/devhost";

it("finds each link to the site once, in Markdown, comments, and prose", () => {
  const texts = [
    `See [Run a stack](${siteUrl}/guides/stack-lifecycle/#start-a-stack) and ${siteUrl}/reference/cli/.`,
    `# Guide: ${siteUrl}/guides/stack-lifecycle/#start-a-stack\n<${siteUrl}/start/serve/>`,
    "Elsewhere: https://example.test/other/ and https://example.test/devhostile/",
  ];

  expect(readSiteUrls(texts, siteUrl)).toEqual([
    `${siteUrl}/guides/stack-lifecycle/#start-a-stack`,
    `${siteUrl}/reference/cli/`,
    `${siteUrl}/start/serve/`,
  ]);
});
