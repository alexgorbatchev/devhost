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
const publishedDocsBaseUrl = "https://alexgorbatchev.github.io/devhost";

syncDocsSite();

function syncDocsSite(): void {
  fs.mkdirSync(docsContentPath, { recursive: true });
  syncLandingPage();
  syncManifestReference();
}

function syncLandingPage(): void {
  const readmeMarkdown: string = fs.readFileSync(readmeSourcePath, "utf8");
  const readmeDocument: IMarkdownDocument = extractMarkdownDocument(readmeMarkdown, "devhost");
  const rewrittenBody: string = rewriteMarkdownLinksForDocsSite(readmeDocument.body);
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

function rewriteMarkdownLinksForDocsSite(markdown: string): string {
  return markdown.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match: string, label: string, rawLink: string): string => {
    const rewrittenLink: string = rewriteDocsSiteLink(rawLink);

    if (rewrittenLink === rawLink) {
      return match;
    }

    return `[${label}](${rewrittenLink})`;
  });
}

function rewriteDocsSiteLink(rawLink: string): string {
  const splitLinkResult: ISplitLinkResult = splitLink(rawLink);
  const normalizedLink: string = splitLinkResult.pathPart.replaceAll("\\", "/");
  const manifestReferenceFileName = "devhost.example.toml";

  if (normalizedLink === publishedDocsBaseUrl || normalizedLink.startsWith(`${publishedDocsBaseUrl}/`)) {
    const relativeDocsPath: string = normalizedLink.slice(publishedDocsBaseUrl.length).replace(/^\//, "");

    return `./${relativeDocsPath}${splitLinkResult.suffix}`;
  }

  if (isExternalOrSpecialLink(normalizedLink)) {
    return rawLink;
  }

  if (normalizedLink === manifestReferenceFileName || normalizedLink.endsWith(`/${manifestReferenceFileName}`)) {
    const manifestLinkPrefix: string = normalizedLink.slice(
      0,
      normalizedLink.length - manifestReferenceFileName.length,
    );

    return `${manifestLinkPrefix}reference/devhost-example/${splitLinkResult.suffix}`;
  }

  if (normalizedLink.startsWith("./docs/")) {
    return `./${convertMarkdownPathToDocsRoute(normalizedLink.slice("./docs/".length))}${splitLinkResult.suffix}`;
  }

  if (normalizedLink.startsWith("docs/")) {
    return `./${convertMarkdownPathToDocsRoute(normalizedLink.slice("docs/".length))}${splitLinkResult.suffix}`;
  }

  if (normalizedLink.endsWith(".md")) {
    return `${convertMarkdownPathToDocsRoute(normalizedLink)}${splitLinkResult.suffix}`;
  }

  return rawLink;
}

function isExternalOrSpecialLink(link: string): boolean {
  return (
    link.startsWith("#") ||
    link.startsWith("/") ||
    link.startsWith("http://") ||
    link.startsWith("https://") ||
    link.startsWith("mailto:")
  );
}

interface ISplitLinkResult {
  pathPart: string;
  suffix: string;
}

function splitLink(link: string): ISplitLinkResult {
  const hashIndex: number = link.indexOf("#");

  if (hashIndex === -1) {
    return { pathPart: link, suffix: "" };
  }

  return {
    pathPart: link.slice(0, hashIndex),
    suffix: link.slice(hashIndex),
  };
}

function convertMarkdownPathToDocsRoute(link: string): string {
  if (!link.endsWith(".md")) {
    return link;
  }

  return `${link.slice(0, -3)}/`;
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
