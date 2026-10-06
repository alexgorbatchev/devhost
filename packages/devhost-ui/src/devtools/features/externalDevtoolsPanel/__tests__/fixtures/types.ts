import type { BrowserContext } from "playwright";
import type { DevframeClientContext } from "@devframes/hub/client";
import type { DevframeViewIframe } from "@devframes/hub";

export type NativeVueHostTest = (hosts: readonly INativeVueHost[], browser: BrowserContext) => Promise<void>;

export interface INativeVueHost {
  url: string;
  rootPath: string;
  controlUrl: string;
  readAuthorizationCode: () => Promise<string>;
  close: () => Promise<void>;
}

export interface INativeVueHostOptions {
  base?: string;
  visibility?: "normal" | "passive" | "hidden";
}

interface IVueNativeFixture {
  readContext: () => DevframeClientContext;
  readVueEntry: () => DevframeViewIframe;
  replaceDock: () => void;
}

declare global {
  interface Window {
    nativeVueFixture: IVueNativeFixture;
  }
}
