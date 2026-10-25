// Finds every link to the published site in the given texts, such as the README and the skill.
export function readSiteUrls(texts: string[], siteUrl: string): string[] {
  const escapedSiteUrl = siteUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`${escapedSiteUrl}(?![^/\\s)"'<>\`\\]])(?:/[^\\s)"'<>\`\\]]*)?`, "g");
  const urls = texts.flatMap((text) => [...text.matchAll(pattern)].map((match) => match[0].replace(/[.,;:]+$/, "")));
  return [...new Set(urls)].sort();
}
