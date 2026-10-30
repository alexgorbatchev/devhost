import type { HotReloadClient } from "./types";

/**
 * Names the dev server's hot reload client in a page from what that client leaves behind. It tells a client loaded
 * from one that is connected: a Vite server started with `server.ws: false` still serves its client.
 */
export function readHotReloadClient(page: Window): HotReloadClient | null {
  if (page.document.querySelector("script[data-bun-dev-server-script]") !== null) return "bun";
  // Before webpack: Next.js has the same global in its webpack mode.
  if (page.document.querySelector("nextjs-portal") !== null) return "next";
  const hasViteClient = page.performance
    .getEntriesByType("resource")
    .some((entry) => new URL(entry.name).pathname.endsWith("/@vite/client"));
  if (hasViteClient) return "vite";
  return Object.keys(page).some((key) => key.startsWith("webpackHotUpdate")) ? "webpack" : null;
}
