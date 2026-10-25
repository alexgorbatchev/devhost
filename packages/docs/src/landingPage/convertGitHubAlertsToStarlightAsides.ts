interface IStarlightAside {
  title: string;
  variant: string;
}

// Rewrites GitHub alert blockquotes, such as `> [!IMPORTANT]`, as Starlight asides, which the landing page renders.
export function convertGitHubAlertsToStarlightAsides(markdown: string): string {
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
