import { useEffect, useState } from "react";
import { readHotReloadClient } from "../readHotReloadClient";
import type { HotReloadClient } from "../types";

/** Clients can arrive after the devtools: bundles finish loading, and Next.js adds its overlay once the page hydrates. */
export function useHotReloadClient(): HotReloadClient | null {
  const [client, setClient] = useState<HotReloadClient | null>(() => readHotReloadClient(window));
  useEffect(() => {
    const read = (): void => setClient(readHotReloadClient(window));
    const resources = new PerformanceObserver(read);
    resources.observe({ type: "resource", buffered: true });
    const elements = new MutationObserver(read);
    elements.observe(document.body, { childList: true });
    return () => {
      resources.disconnect();
      elements.disconnect();
    };
  }, []);
  return client;
}
