import fs from "node:fs";
import path from "node:path";

import {
  marketingRecordingScenarios,
  type IMarketingRecordingScenario,
} from "./src/recordings/marketingRecordingScenarios";

interface IMarkdownDocument {
  title: string;
  body: string;
}

const docsPackagePath = import.meta.dir;
const repositoryRootPath = path.resolve(docsPackagePath, "../..");
const docsContentPath = path.join(docsPackagePath, "src/content/docs");
const readmeSourcePath = path.join(repositoryRootPath, "apps/devhost/README.md");
const manifestReferenceSourcePath = path.join(repositoryRootPath, "apps/devhost/devhost.example.toml");
const architectureDocsSourcePath = path.join(repositoryRootPath, "apps/devhost/docs");

syncDocsSite();

function syncDocsSite(): void {
  ensureCleanDirectory(docsContentPath);
  fs.writeFileSync(path.join(docsContentPath, ".gitkeep"), "");
  syncLandingPage();
  syncManifestReference();
  syncArchitectureDocs();
}

function ensureCleanDirectory(directoryPath: string): void {
  fs.rmSync(directoryPath, { recursive: true, force: true });
  fs.mkdirSync(directoryPath, { recursive: true });
}

function syncLandingPage(): void {
  const readmeMarkdown: string = fs.readFileSync(readmeSourcePath, "utf8");
  const readmeDocument: IMarkdownDocument = extractMarkdownDocument(readmeMarkdown, "devhost");
  const rewrittenBody: string = readmeDocument.body.replaceAll(
    "(./devhost.example.toml)",
    "(./reference/devhost-example/)",
  );
  const indexPath: string = path.join(docsContentPath, "index.mdx");

  fs.writeFileSync(indexPath, createLandingPage(readmeDocument.title, rewrittenBody));
}

function syncManifestReference(): void {
  const manifestReferenceContents: string = fs.readFileSync(manifestReferenceSourcePath, "utf8");
  const manifestReferencePagePath: string = path.join(docsContentPath, "reference/devhost-example.md");
  const manifestReferencePageBody: string = [
    "The canonical manifest reference is generated from `apps/devhost/devhost.example.toml`.",
    "",
    "```toml",
    manifestReferenceContents.trimEnd(),
    "```",
  ].join("\n");

  fs.mkdirSync(path.dirname(manifestReferencePagePath), { recursive: true });
  fs.writeFileSync(manifestReferencePagePath, createMarkdownPage("Manifest reference", manifestReferencePageBody));
}

function syncArchitectureDocs(): void {
  const markdownFiles = new Bun.Glob("**/*.md").scanSync({ cwd: architectureDocsSourcePath });

  for (const relativeSourcePath of markdownFiles) {
    if (relativeSourcePath === "AGENTS.md") {
      continue;
    }

    const sourcePath: string = path.join(architectureDocsSourcePath, relativeSourcePath);
    const sourceMarkdown: string = fs.readFileSync(sourcePath, "utf8");
    const sourceDocument: IMarkdownDocument = extractMarkdownDocument(
      sourceMarkdown,
      createTitleFromRelativePath(relativeSourcePath),
    );
    const destinationPath: string = path.join(docsContentPath, "architecture", relativeSourcePath);

    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.writeFileSync(destinationPath, createMarkdownPage(sourceDocument.title, sourceDocument.body));
  }
}

function extractMarkdownDocument(markdown: string, fallbackTitle: string): IMarkdownDocument {
  const headingMatch = markdown.match(/^#\s+(.+)$/m);

  if (!headingMatch) {
    return {
      title: sanitizeTitle(fallbackTitle),
      body: markdown.trim(),
    };
  }

  const title: string = sanitizeTitle(headingMatch[1].trim());
  const body: string = markdown.replace(/^#\s+.+\n*/m, "").trim();

  return { title, body };
}

function sanitizeTitle(title: string): string {
  return title.replaceAll("`", "");
}

function createTitleFromRelativePath(relativePath: string): string {
  const fileName: string = path.basename(relativePath, ".md");
  const words: string[] = fileName.split("-");

  return words.map((word: string): string => word.slice(0, 1).toUpperCase() + word.slice(1)).join(" ");
}

function createMarkdownPage(title: string, body: string): string {
  const trimmedBody: string = body.trim();

  return `---\ntitle: ${JSON.stringify(title)}\n---\n\n${trimmedBody}\n`;
}

function createLandingPage(title: string, body: string): string {
  const trimmedBody: string = body.trim();
  const recordingsIntro: string = [
    'import { Tabs, TabItem } from "@astrojs/starlight/components";',
    'import MarketingRecordingPlayer from "../../components/MarketingRecordingPlayer.astro";',
    "",
    "## Product walkthroughs",
    "",
    "These replays are generated from the browser-hosted marketing recorder under `packages/docs/public/recordings/marketing/`.",
    "",
    "<Tabs>",
    ...marketingRecordingScenarios.flatMap((scenario: IMarketingRecordingScenario): string[] => {
      const recordingUrl: string = `./recordings/marketing/${scenario.recordingFileName}`;

      return [
        `  <TabItem label=${JSON.stringify(scenario.label)}>`,
        `    <MarketingRecordingPlayer recordingHeight={${scenario.viewport.height}} recordingLabel=${JSON.stringify(scenario.label)} recordingUrl=${JSON.stringify(recordingUrl)} recordingWidth={${scenario.viewport.width}} />`,
        "  </TabItem>",
      ];
    }),
    "</Tabs>",
  ].join("\n");

  return `---\ntitle: ${JSON.stringify(title)}\n---\n\n${recordingsIntro}\n\n${trimmedBody}\n`;
}
