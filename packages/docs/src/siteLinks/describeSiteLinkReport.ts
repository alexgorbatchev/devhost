import type { ISiteLinkReport } from "./types";

export function describeSiteLinkReport(report: ISiteLinkReport): string[] {
  return [
    ...report.broken.map(({ page, url, reason }) => `${page} links to ${url}: ${reason}`),
    ...report.unreachedPages.map(
      (page) => `${page} is not linked from any page; add it to the sidebar in astro.config.mjs`,
    ),
  ];
}
