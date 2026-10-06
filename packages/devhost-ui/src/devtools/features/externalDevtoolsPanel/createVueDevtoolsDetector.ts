import type { DevframeDockEntry } from "@devframes/hub";
import { getDevframeClientContext } from "@devframes/hub/client";
import type { DevframeClientContext } from "@devframes/hub/client";
import { evaluateWhen } from "devframe/utils/when";

import type { IExternalDevtoolsAdapter, IExternalDevtoolsDetector } from "./types";
import { readHostVueDevtoolsKit } from "./vueDevtools/readHostVueDevtoolsKit";
import type { IHostVueDevtoolsKit, IVueLauncherSuppression } from "./vueDevtools/types";

/** Native Vue9/Vite8 host integration. All registrations, metadata and panels stay upstream-owned. */
export function createVueDevtoolsDetector(hostDocument: Document): IExternalDevtoolsDetector {
  const suppressions = new Map<ShadowRoot, IVueLauncherSuppression>();
  let context: DevframeClientContext | undefined;
  let kit: IHostVueDevtoolsKit | undefined;
  let hasApps = false;
  let isQueryPending = false;
  let isMetadataSubscribed = false;
  let onChange: (() => void) | undefined;
  let disposers: (() => void)[] = [];
  let generation = 0;

  function releaseSuppression(root: ShadowRoot): void {
    const suppression = suppressions.get(root);
    if (suppression === undefined) return;
    suppression.observer.disconnect();
    root.adoptedStyleSheets = root.adoptedStyleSheets.filter((sheet) => sheet !== suppression.sheet);
    suppressions.delete(root);
  }

  function releaseContext(): void {
    generation += 1;
    for (const dispose of disposers) dispose();
    disposers = [];
    for (const root of suppressions.keys()) releaseSuppression(root);
    context = undefined;
    kit = undefined;
    hasApps = false;
    isQueryPending = false;
    isMetadataSubscribed = false;
  }

  function subscribeMetadata(): void {
    const currentContext = context;
    if (
      isMetadataSubscribed ||
      currentContext?.rpc.isTrusted !== true ||
      !currentContext.rpc.sharedState.keys().includes("devframe:docks")
    )
      return;
    // Before authorization, get() creates a deferred state instead of returning the native UI's cache.
    // Observe only the existing authorized store; never initialize a competing registry.
    isMetadataSubscribed = true;
    const subscriptionGeneration = generation;
    void currentContext.rpc.sharedState
      .get<DevframeDockEntry[]>("devframe:docks")
      .then((state) => {
        if (subscriptionGeneration !== generation || onChange === undefined) return;
        disposers.push(
          state.on("updated", () => {
            onChange?.();
          }),
        );
        onChange();
      })
      .catch(() => {
        if (subscriptionGeneration !== generation || onChange === undefined) return;
        isMetadataSubscribed = false;
        onChange();
      });
  }

  function refreshApps(): void {
    const currentKit = kit;
    if (currentKit === undefined || isQueryPending) return;
    const queryGeneration = generation;
    isQueryPending = true;
    void currentKit.runtime
      .query({ type: "apps:snapshot" })
      .then((snapshot) => {
        if (queryGeneration !== generation || onChange === undefined) return;
        isQueryPending = false;
        const nextHasApps = snapshot.apps.length > 0;
        if (hasApps !== nextHasApps) {
          hasApps = nextHasApps;
          onChange();
        }
      })
      .catch(() => {
        if (queryGeneration !== generation || onChange === undefined) return;
        isQueryPending = false;
        if (hasApps) {
          hasApps = false;
          onChange();
        }
      });
  }

  function synchronizeContext(): void {
    if (onChange === undefined) return;
    const hostWindow = hostDocument.defaultView;
    const nextKit = hostWindow === null ? undefined : readHostVueDevtoolsKit(hostWindow);
    const nextContext = getDevframeClientContext();
    if (context === nextContext && kit === nextKit) {
      subscribeMetadata();
      refreshApps();
      return;
    }
    releaseContext();
    if (nextKit === undefined || nextContext === undefined || nextContext.clientType !== "embedded") return;
    context = nextContext;
    kit = nextKit;
    const notify = (): void => {
      onChange?.();
    };
    disposers = [
      context.panel.events.on("panel:state:changed", notify),
      context.connection.events.on("connection:status", notify),
      context.rpc.events.on("rpc:is-trusted:updated", notify),
      kit.runtime.subscribe("apps:changed", refreshApps),
      kit.runtime.subscribe("app:unmount", refreshApps),
      kit.runtime.subscribe("app:init", refreshApps),
    ];
    subscribeMetadata();
    refreshApps();
  }

  function readAdapters(): readonly IExternalDevtoolsAdapter[] {
    synchronizeContext();
    const currentContext = context;
    const entry = currentContext?.docks.entries.find(
      (candidate) =>
        candidate.id === "vue-devtools" && candidate.type === "iframe" && candidate.frameId === "vue-devtools",
    );
    const roots = Array.from(hostDocument.querySelectorAll("devframes-dock-embedded")).flatMap((element) =>
      element.shadowRoot === null ? [] : [element.shadowRoot],
    );
    const isAvailable =
      hasApps &&
      currentContext !== undefined &&
      currentContext.rpc.isTrusted === true &&
      currentContext.panel.state.state !== "hidden" &&
      entry !== undefined &&
      (!entry.when || evaluateWhen(entry.when, currentContext.when.context)) &&
      (!entry.visibility || evaluateWhen(entry.visibility, currentContext.when.context)) &&
      currentContext.docks.entries.filter((candidate) => candidate.title === entry.title).length === 1;
    const selector =
      entry === undefined ? "" : `.devframes-dock-entry:has(> button[aria-label=${CSS.escape(entry.title)}])`;
    const installedRoots = isAvailable
      ? roots.filter((root) => root.querySelector("#devframes-dock, #devframes-edge-panel") !== null)
      : [];
    for (const root of suppressions.keys()) {
      if (!roots.includes(root)) releaseSuppression(root);
    }
    for (const root of roots) {
      let suppression = suppressions.get(root);
      if (suppression === undefined) {
        const sheet = new CSSStyleSheet();
        const observer = new MutationObserver(() => {
          onChange?.();
        });
        observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-label"] });
        suppression = { sheet, observer, text: "" };
        suppressions.set(root, suppression);
      }
      if (!installedRoots.includes(root)) {
        root.adoptedStyleSheets = root.adoptedStyleSheets.filter((sheet) => sheet !== suppression.sheet);
        continue;
      }
      const text = `${selector} { display: none !important; }`;
      if (suppression.text !== text) {
        suppression.sheet.replaceSync(text);
        suppression.text = text;
      }
      if (!root.adoptedStyleSheets.includes(suppression.sheet)) root.adoptedStyleSheets.push(suppression.sheet);
    }
    if (installedRoots.length === 0 || currentContext === undefined) return [];
    const isOpen = (): boolean =>
      currentContext.panel.state.state === "open" && currentContext.panel.state.selectedDockId === "vue-devtools";
    return [
      {
        id: "vue-devtools",
        label: "Vue",
        title: `Toggle Vue inspector (${currentContext.connection.status})`,
        hideSelectors: [],
        isInstalled: () =>
          context === currentContext &&
          hasApps &&
          currentContext.rpc.isTrusted === true &&
          currentContext.panel.state.state !== "hidden" &&
          installedRoots.some((root) => root.host.isConnected),
        isOpen,
        open: (): void => {
          void currentContext.docks.switchEntry("vue-devtools").catch(() => {
            onChange?.();
          });
        },
        close: (): void => {
          if (isOpen())
            void currentContext.docks.switchEntry(null).catch(() => {
              onChange?.();
            });
        },
      },
    ];
  }

  return {
    readAdapters,
    subscribe: (listener): (() => void) => {
      onChange = listener;
      return (): void => {
        onChange = undefined;
        releaseContext();
      };
    },
  };
}
