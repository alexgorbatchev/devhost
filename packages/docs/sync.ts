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
  const rewrittenBody: string = convertGitHubAlertsToStarlightAsides(
    rewriteMarkdownLinksForDocsSite(readmeDocument.body),
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

interface IStarlightAside {
  title: string;
  variant: string;
}

function convertGitHubAlertsToStarlightAsides(markdown: string): string {
  const lines: string[] = markdown.split("\n");
  const convertedLines: string[] = [];
  let lineIndex: number = 0;

  while (lineIndex < lines.length) {
    const alertMatch = lines[lineIndex].match(/^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/);

    if (!alertMatch) {
      convertedLines.push(lines[lineIndex]);
      lineIndex += 1;
      continue;
    }

    const aside: IStarlightAside = mapGitHubAlertToStarlightAside(alertMatch[1]);
    const alertContentLines: string[] = [];
    lineIndex += 1;

    while (lineIndex < lines.length && lines[lineIndex].startsWith(">")) {
      alertContentLines.push(removeMarkdownBlockquotePrefix(lines[lineIndex]));
      lineIndex += 1;
    }

    const trimmedContent: string = trimBlankLines(alertContentLines).join("\n");
    convertedLines.push(`:::${aside.variant}[${aside.title}]`);

    if (trimmedContent.length > 0) {
      convertedLines.push(trimmedContent);
    }

    convertedLines.push(":::");
  }

  return convertedLines.join("\n");
}

function mapGitHubAlertToStarlightAside(alertType: string): IStarlightAside {
  switch (alertType) {
    case "NOTE":
      return { title: "Note", variant: "note" };
    case "TIP":
      return { title: "Tip", variant: "tip" };
    case "IMPORTANT":
      return { title: "Important", variant: "caution" };
    case "WARNING":
      return { title: "Warning", variant: "caution" };
    case "CAUTION":
      return { title: "Caution", variant: "danger" };
    default:
      return { title: alertType, variant: "note" };
  }
}

function removeMarkdownBlockquotePrefix(line: string): string {
  return line.replace(/^>\s?/, "");
}

function trimBlankLines(lines: string[]): string[] {
  let startIndex: number = 0;
  let endIndex: number = lines.length;

  while (startIndex < endIndex && lines[startIndex].trim().length === 0) {
    startIndex += 1;
  }

  while (endIndex > startIndex && lines[endIndex - 1].trim().length === 0) {
    endIndex -= 1;
  }

  return lines.slice(startIndex, endIndex);
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
