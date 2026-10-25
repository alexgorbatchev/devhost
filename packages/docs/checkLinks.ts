import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { checkSiteLinks } from "./src/siteLinks/checkSiteLinks";
import { describeSiteLinkReport } from "./src/siteLinks/describeSiteLinkReport";
import { readSiteUrls } from "./src/siteLinks/readSiteUrls";

const docsPackagePath = import.meta.dir;
const repositoryRootPath = resolve(docsPackagePath, "../..");
const siteUrl = "https://alexgorbatchev.github.io/devhost";
// Files outside the site that link into it; a renamed page or heading must not break them.
const sourcePatterns = ["apps/devhost/README.md", "apps/devhost/devhost.example.toml", "skills/devhost/**/*.md"];

const sourcePaths = (
  await Promise.all(
    sourcePatterns.map((pattern) => Array.fromAsync(new Bun.Glob(pattern).scan({ cwd: repositoryRootPath }))),
  )
).flat();
const texts = await Promise.all(sourcePaths.map((path) => readFile(join(repositoryRootPath, path), "utf8")));

const parentPath = resolve(repositoryRootPath, ".tmp/docs-site-links");
await mkdir(parentPath, { recursive: true });
const stagingPath = await mkdtemp(join(parentPath, "site-"));
try {
  const report = await checkSiteLinks({
    distPath: join(docsPackagePath, "dist"),
    basePath: "/devhost",
    siteUrl,
    stagingPath,
    sourceUrls: readSiteUrls(texts, siteUrl),
  });
  const problems = describeSiteLinkReport(report);
  if (problems.length > 0) throw new Error(`The built docs site has broken links:\n${problems.join("\n")}`);
  console.log("Every link on the docs site, and every link to it, resolves.");
} finally {
  await rm(stagingPath, { recursive: true, force: true });
}
