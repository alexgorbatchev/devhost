import type { HotReloadClient } from "./types";

export const HOT_RELOAD_CLIENT_LABELS: Readonly<Record<HotReloadClient, string>> = {
  bun: "Bun",
  next: "Next.js",
  vite: "Vite",
  webpack: "webpack",
};
