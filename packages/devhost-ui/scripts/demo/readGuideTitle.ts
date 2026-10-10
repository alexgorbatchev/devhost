// Reads a guide's title from the frontmatter of its page, so a guide film is titled as its page is.
export function readGuideTitle(markdown: string): string {
  const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(markdown)?.[1];
  const title = frontmatter === undefined ? undefined : /^title:\s*(.+)$/m.exec(frontmatter)?.[1]?.trim();
  if (title === undefined || title === "") throw new Error("The guide has no title in its frontmatter");
  return title.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
}
