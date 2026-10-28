// Design prototypes served from `packages/design`; `file` is relative to that package.
export const PROTOTYPES = [
  { label: "Devtools prototype", path: "/prototypes/references/devtools.html", file: "references/devtools.html" },
  { label: "Docs prototype", path: "/prototypes/references/docs.html", file: "references/docs.html" },
  { label: "Status pages", path: "/prototypes/references/status-pages.html", file: "references/status-pages.html" },
  { label: "Design system", path: "/prototypes/references/design-system.html", file: "references/design-system.html" },
];

// Keep stylesheet URLs aligned with the relative links in each prototype.
export const PROTOTYPE_STYLESHEETS = [
  { path: "/prototypes/tokens.css", file: "tokens.css" },
  { path: "/prototypes/references/status-pages.css", file: "references/status-pages.css" },
];

// A document of its own outside the router, linked beside the prototypes.
export const VIDEOS_PAGE = { label: "Demo videos", path: "/videos" };

// The videos page reads its list and every media file from under this path.
export const DEMO_VIDEOS_PATH = "/demo-videos/";
export const DEMO_VIDEOS_INDEX_PATH = `${DEMO_VIDEOS_PATH}index.json`;
