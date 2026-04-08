export interface IManagedCaddyNotFoundRouteLink {
  host: string;
  path: string;
  url: string;
}

export function renderManagedCaddyNotFoundPage(routeLinks: IManagedCaddyNotFoundRouteLink[]): string {
  const renderedRoutes: string = routeLinks.length > 0 ? renderRouteList(routeLinks) : renderEmptyState();

  return [
    "<!doctype html>",
    '<html lang="en">',
    "  <head>",
    '    <meta charset="utf-8">',
    '    <meta name="viewport" content="width=device-width, initial-scale=1">',
    "    <title>devhost route not found</title>",
    '    <link rel="stylesheet" href="/devhost-route-not-found.css">',
    "  </head>",
    "  <body>",
    '    <main class="devhost-not-found">',
    '      <p class="devhost-not-found__code">404</p>',
    '      <h1 class="devhost-not-found__title">No active devhost route matched this hostname.</h1>',
    '      <p class="devhost-not-found__body">',
    "        The request reached the managed devhost Caddy instance, but this hostname is not currently mapped to an",
    "        active route. If you expected an app here, check that the stack is running and that the service has claimed",
    "        the correct host.",
    "      </p>",
    '      <section class="devhost-not-found__routes" aria-labelledby="devhost-not-found-routes">',
    '        <h2 class="devhost-not-found__label" id="devhost-not-found-routes">Active routes</h2>',
    renderedRoutes,
    "      </section>",
    "    </main>",
    "  </body>",
    "</html>",
    "",
  ].join("\n");
}

function renderRouteList(routeLinks: IManagedCaddyNotFoundRouteLink[]): string {
  return [
    '        <ul class="devhost-not-found__list">',
    ...routeLinks.map((routeLink: IManagedCaddyNotFoundRouteLink): string => {
      return renderRouteListItem(routeLink);
    }),
    "        </ul>",
  ].join("\n");
}

function renderRouteListItem(routeLink: IManagedCaddyNotFoundRouteLink): string {
  const routeLabel: string = `${routeLink.host}${routeLink.path === "/" ? "/" : routeLink.path}`;

  return [
    "          <li>",
    `            <a class="devhost-not-found__link" href="${escapeHtml(routeLink.url)}">`,
    `              <span class="devhost-not-found__route">${escapeHtml(routeLabel)}</span>`,
    '              <span class="devhost-not-found__arrow" aria-hidden="true">↗</span>',
    "            </a>",
    "          </li>",
  ].join("\n");
}

function renderEmptyState(): string {
  return [
    '        <p class="devhost-not-found__empty">',
    "          No devhost routes are active right now. Start a stack and the available hostnames will appear here.",
    "        </p>",
  ].join("\n");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
