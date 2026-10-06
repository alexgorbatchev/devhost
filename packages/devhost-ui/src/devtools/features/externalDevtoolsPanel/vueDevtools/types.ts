import type { DevtoolsRuntime } from "@vue/devtools-kit";

export interface IHostVueDevtoolsKit {
  enabled: boolean;
  runtime: Pick<DevtoolsRuntime, "query" | "subscribe">;
}

export interface IVueLauncherSuppression {
  sheet: CSSStyleSheet;
  observer: MutationObserver;
  text: string;
}
