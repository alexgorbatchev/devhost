import type { ISiteTitleParts } from "./types";

export function splitSiteTitle(siteTitle: string): ISiteTitleParts {
  const nameStart = siteTitle.lastIndexOf("/") + 1;

  return { scope: siteTitle.slice(0, nameStart), name: siteTitle.slice(nameStart) };
}
