import { cp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LinkChecker, LinkState, type LinkResult } from "linkinator";
import type { ICheckSiteLinksOptions, ISiteLinkProblem, ISiteLinkReport } from "./types";

const sourceLinksPageName = "__source-links__.html";

// Serves the built site under its base path and follows every link from the landing page and from the given
// source links, checking that each one reaches a page or file and, when it has a fragment, a heading on that page.
export async function checkSiteLinks(options: ICheckSiteLinksOptions): Promise<ISiteLinkReport> {
  const base = options.basePath.replace(/^\/|\/$/g, "");
  const sitePath = join(options.stagingPath, base);
  await cp(options.distPath, sitePath, { recursive: true });
  await writeFile(join(sitePath, sourceLinksPageName), createSourceLinksPage(options));

  const result = await new LinkChecker().check({
    path: [`${base}/`, `${base}/${sourceLinksPageName}`],
    serverRoot: options.stagingPath,
    recurse: true,
    checkFragments: true,
    // Links to other sites are not this site's to check, and checking them would need the network.
    linksToSkip: async (link) => !isLocalLink(link),
  });

  const sourcePage = toSitePath(`${base}/${sourceLinksPageName}`);
  const broken = new Map<string, ISiteLinkProblem>();
  const reached = new Set<string>();
  for (const link of result.links) {
    const url = toSitePath(link.url);
    if (link.state === LinkState.OK) reached.add(url.replace(/#.*$/, ""));
    if (link.state !== LinkState.BROKEN) continue;
    const page = link.parent === undefined ? url : toSitePath(link.parent);
    const problem: ISiteLinkProblem = {
      page: page === sourcePage ? "a source file" : page,
      url,
      reason: describeFailure(link),
    };
    broken.set(`${problem.page} ${problem.url}`, problem);
  }

  const pages = await listSitePages(options.distPath, base);
  return {
    broken: [...broken.values()].sort((a, b) => `${a.page} ${a.url}`.localeCompare(`${b.page} ${b.url}`)),
    unreachedPages: pages.filter((page) => !reached.has(page)),
  };
}

function createSourceLinksPage(options: ICheckSiteLinksOptions): string {
  const anchors = options.sourceUrls.map((url) => {
    const href = options.basePath.replace(/\/$/, "") + url.slice(options.siteUrl.replace(/\/$/, "").length);
    return `<a href="${href.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}">${href}</a>`;
  });
  return `<!doctype html><html><head><title>Source links</title></head><body>${anchors.join("\n")}</body></html>`;
}

function isLocalLink(link: string): boolean {
  const { hostname } = new URL(link);
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

// The checker reports links on its own server relative to the server root, such as `devhost/guides/`, and the
// directory it started from without its trailing slash.
function toSitePath(url: string): string {
  const parsed = new URL(url, "http://site.invalid/");
  const isDirectory = !parsed.pathname.endsWith("/") && !/\.[^/]+$/.test(parsed.pathname);
  return `${parsed.pathname}${isDirectory ? "/" : ""}${parsed.hash}`;
}

function describeFailure(link: LinkResult): string {
  const failure = link.failureDetails?.find((detail): detail is Error => detail instanceof Error);
  if (failure !== undefined) return failure.message;
  return link.status === undefined || link.status === 0 ? "no response" : `HTTP ${link.status}`;
}

async function listSitePages(distPath: string, base: string): Promise<string[]> {
  const files = await Array.fromAsync(new Bun.Glob("**/*.html").scan({ cwd: distPath, onlyFiles: true }));
  return files
    .filter((file) => file !== "404.html")
    .map((file) => `/${base}/${file.replace(/(^|\/)index\.html$/, "$1")}`)
    .sort();
}
