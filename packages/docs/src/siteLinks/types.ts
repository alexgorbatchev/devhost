export interface ISiteLinkProblem {
  // Site path of the page that holds the link, such as `/devhost/guides/devtools/`.
  page: string;
  // The link as the checker resolved it: a site path, with its fragment when one was checked.
  url: string;
  // The HTTP status, or what failed when the page answered but the fragment or the request did not.
  reason: string;
}

export interface ISiteLinkReport {
  broken: ISiteLinkProblem[];
  // Built pages that no link on the site reaches, such as a page left out of the sidebar.
  unreachedPages: string[];
}

export interface ICheckSiteLinksOptions {
  // The built site, as `astro build` writes it.
  distPath: string;
  // The path the site is published under, such as `/devhost`.
  basePath: string;
  // Origin and base the site is published at, such as `https://alexgorbatchev.github.io/devhost`.
  siteUrl: string;
  // An empty directory the site is copied into, so it can be served under its base path.
  stagingPath: string;
  // Links to the published site from files outside it, which must reach a built page and heading too.
  sourceUrls: string[];
}
