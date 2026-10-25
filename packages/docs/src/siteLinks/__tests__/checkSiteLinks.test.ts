import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it } from "bun:test";
import { checkSiteLinks } from "../checkSiteLinks";
import { createTestDirectory, writeSite } from "./helpers";

const siteUrl = "https://example.test/devhost";
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function check(pages: Record<string, string>, sourceUrls: string[] = []) {
  const directory = await createTestDirectory();
  directories.push(directory);
  const distPath = join(directory, "dist");
  const stagingPath = join(directory, "staging");
  await mkdir(stagingPath);
  await writeSite(distPath, pages);
  return checkSiteLinks({ distPath, basePath: "/devhost", siteUrl, stagingPath, sourceUrls });
}

it("accepts relative and base-prefixed links to pages, headings, and files", async () => {
  const report = await check(
    {
      "index.html": `<a href="/devhost/guides/one/">One</a> <a href="guides/two/#usage">Two</a> <img src="/devhost/logo.svg">`,
      "guides/one/index.html": `<h2 id="setup">Setup</h2> <a href="../two/">Two</a>`,
      "guides/two/index.html": `<h2 id="usage">Usage</h2> <a href="../one/#setup">Setup</a>`,
      "logo.svg": "",
      "404.html": "",
    },
    [`${siteUrl}/guides/one/#setup`],
  );

  expect(report).toEqual({ broken: [], unreachedPages: [] });
});

it("reports links to missing pages and headings with the page that holds them", async () => {
  const report = await check({
    "index.html": `<a href="/devhost/guides/one/">One</a>`,
    "guides/one/index.html": `<a href="./two/">Two</a> <a href="/devhost/#nowhere">Home</a>`,
  });

  expect(report.broken.map(({ page, url }) => ({ page, url }))).toEqual([
    { page: "/devhost/guides/one/", url: "/devhost/#nowhere" },
    { page: "/devhost/guides/one/", url: "/devhost/guides/one/two/" },
  ]);
  expect(report.broken.every(({ reason }) => reason.length > 0)).toBe(true);
});

it("reports a link from a source file that names a missing page or heading", async () => {
  const report = await check({ "index.html": `<h2 id="install">Install</h2>` }, [
    `${siteUrl}/#install`,
    `${siteUrl}/#upgrade`,
    `${siteUrl}/reference/gone/`,
  ]);

  expect(report.broken.map(({ page, url }) => ({ page, url }))).toEqual([
    { page: "a source file", url: "/devhost/#upgrade" },
    { page: "a source file", url: "/devhost/reference/gone/" },
  ]);
});

it("reports built pages that no link reaches", async () => {
  const report = await check({
    "index.html": `<a href="/devhost/guides/one/">One</a>`,
    "guides/one/index.html": "",
    "guides/orphan/index.html": "",
  });

  expect(report.unreachedPages).toEqual(["/devhost/guides/orphan/"]);
});

it("leaves links to other sites unchecked", async () => {
  const report = await check({ "index.html": `<a href="https://unreachable.invalid/page">Elsewhere</a>` });

  expect(report.broken).toEqual([]);
});
