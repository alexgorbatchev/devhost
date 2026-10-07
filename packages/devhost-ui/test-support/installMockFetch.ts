import { vi, type Mock } from "vitest";

import type { FetchFunction } from "../src/devtools/shared/pristineFetch";

type RestoreFetch = () => void;

export interface IInstalledMockFetch {
  /** Answers the requests the code under test makes, in order, with what the test queued on it. */
  fetch: Mock<FetchFunction>;
  restore: RestoreFetch;
}

/** Replaces `globalThis.fetch`, the function devtools control-plane clients use outside production. */
export function installMockFetch(): IInstalledMockFetch {
  const originalFetch: unknown = Reflect.get(globalThis, "fetch");
  const fetch = vi.fn<FetchFunction>();

  Reflect.set(globalThis, "fetch", fetch);

  return {
    fetch,
    restore: (): void => {
      Reflect.set(globalThis, "fetch", originalFetch);
    },
  };
}
