import { useRef, useState, type JSX, type KeyboardEvent } from "react";

import { FeatureReplay } from "./FeatureReplay";

type FeatureHighlightId = "annotation" | "source-jumps" | "sessions" | "overlay" | "routing-health";

const featureTabOrder: FeatureHighlightId[] = ["annotation", "source-jumps", "sessions", "overlay", "routing-health"];

export function FeatureSection(): JSX.Element {
  const [activeFeatureId, setActiveFeatureId] = useState<FeatureHighlightId>("annotation");
  const featureTabRefs = useRef<Map<FeatureHighlightId, HTMLButtonElement>>(new Map());
  const activeFeaturePanelId: string = createFeaturePanelId(activeFeatureId);
  const activeFeatureTabId: string = createFeatureTabId(activeFeatureId);

  function handleFeatureTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, featureId: FeatureHighlightId): void {
    const currentFeatureIndex: number = findFeatureIndexById(featureId);
    const lastFeatureIndex: number = featureTabOrder.length - 1;

    let nextFeatureIndex: number | null = null;

    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight": {
        nextFeatureIndex = currentFeatureIndex === lastFeatureIndex ? 0 : currentFeatureIndex + 1;
        break;
      }
      case "ArrowLeft":
      case "ArrowUp": {
        nextFeatureIndex = currentFeatureIndex === 0 ? lastFeatureIndex : currentFeatureIndex - 1;
        break;
      }
      case "Home": {
        nextFeatureIndex = 0;
        break;
      }
      case "End": {
        nextFeatureIndex = lastFeatureIndex;
        break;
      }
      default: {
        return;
      }
    }

    event.preventDefault();

    if (nextFeatureIndex === null) {
      return;
    }

    const nextFeatureId = featureTabOrder[nextFeatureIndex];

    if (nextFeatureId === undefined) {
      return;
    }

    setActiveFeatureId(nextFeatureId);
    featureTabRefs.current.get(nextFeatureId)?.focus();
  }

  return (
    <section className="grid gap-4" aria-labelledby="feature-section-title">
      <div className="grid gap-3">
        <h2
          id="feature-section-title"
          className="text-balance text-3xl font-medium leading-tight tracking-[-0.06em] text-foreground sm:text-4xl"
        >
          A routed development surface, not another localhost wrapper.
        </h2>
        <p className="text-sm leading-7 text-muted-foreground">
          The point is not to proxy everything. The point is to expose the right host, keep the stack honest, and
          put the debugging workflow where the page already lives.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[240px_minmax(0,1fr)_280px]">
        <div className="rounded-lg border border-border-subtle bg-card p-2 shadow-[var(--shadow-soft)]">
          <div className="grid gap-2" role="tablist" aria-label="Devhost product highlights" aria-orientation="vertical">
            <button
              id={createFeatureTabId("annotation")}
              ref={createFeatureTabRef(featureTabRefs, "annotation")}
              type="button"
              role="tab"
              className={readFeatureTabClassName(activeFeatureId === "annotation")}
              aria-controls={createFeaturePanelId("annotation")}
              aria-selected={activeFeatureId === "annotation"}
              tabIndex={activeFeatureId === "annotation" ? 0 : -1}
              onClick={(): void => {
                setActiveFeatureId("annotation");
              }}
              onKeyDown={(event: KeyboardEvent<HTMLButtonElement>): void => {
                handleFeatureTabKeyDown(event, "annotation");
              }}
            >
              <span>Annotation handoff</span>
              <span aria-hidden="true" className="text-[0.72rem] uppercase tracking-[0.22em] opacity-70">
                01
              </span>
            </button>
            <button
              id={createFeatureTabId("source-jumps")}
              ref={createFeatureTabRef(featureTabRefs, "source-jumps")}
              type="button"
              role="tab"
              className={readFeatureTabClassName(activeFeatureId === "source-jumps")}
              aria-controls={createFeaturePanelId("source-jumps")}
              aria-selected={activeFeatureId === "source-jumps"}
              tabIndex={activeFeatureId === "source-jumps" ? 0 : -1}
              onClick={(): void => {
                setActiveFeatureId("source-jumps");
              }}
              onKeyDown={(event: KeyboardEvent<HTMLButtonElement>): void => {
                handleFeatureTabKeyDown(event, "source-jumps");
              }}
            >
              <span>Source navigation</span>
              <span aria-hidden="true" className="text-[0.72rem] uppercase tracking-[0.22em] opacity-70">
                02
              </span>
            </button>
            <button
              id={createFeatureTabId("sessions")}
              ref={createFeatureTabRef(featureTabRefs, "sessions")}
              type="button"
              role="tab"
              className={readFeatureTabClassName(activeFeatureId === "sessions")}
              aria-controls={createFeaturePanelId("sessions")}
              aria-selected={activeFeatureId === "sessions"}
              tabIndex={activeFeatureId === "sessions" ? 0 : -1}
              onClick={(): void => {
                setActiveFeatureId("sessions");
              }}
              onKeyDown={(event: KeyboardEvent<HTMLButtonElement>): void => {
                handleFeatureTabKeyDown(event, "sessions");
              }}
            >
              <span>Terminal sessions</span>
              <span aria-hidden="true" className="text-[0.72rem] uppercase tracking-[0.22em] opacity-70">
                03
              </span>
            </button>
            <button
              id={createFeatureTabId("overlay")}
              ref={createFeatureTabRef(featureTabRefs, "overlay")}
              type="button"
              role="tab"
              className={readFeatureTabClassName(activeFeatureId === "overlay")}
              aria-controls={createFeaturePanelId("overlay")}
              aria-selected={activeFeatureId === "overlay"}
              tabIndex={activeFeatureId === "overlay" ? 0 : -1}
              onClick={(): void => {
                setActiveFeatureId("overlay");
              }}
              onKeyDown={(event: KeyboardEvent<HTMLButtonElement>): void => {
                handleFeatureTabKeyDown(event, "overlay");
              }}
            >
              <span>Devtools overlay</span>
              <span aria-hidden="true" className="text-[0.72rem] uppercase tracking-[0.22em] opacity-70">
                04
              </span>
            </button>
            <button
              id={createFeatureTabId("routing-health")}
              ref={createFeatureTabRef(featureTabRefs, "routing-health")}
              type="button"
              role="tab"
              className={readFeatureTabClassName(activeFeatureId === "routing-health")}
              aria-controls={createFeaturePanelId("routing-health")}
              aria-selected={activeFeatureId === "routing-health"}
              tabIndex={activeFeatureId === "routing-health" ? 0 : -1}
              onClick={(): void => {
                setActiveFeatureId("routing-health");
              }}
              onKeyDown={(event: KeyboardEvent<HTMLButtonElement>): void => {
                handleFeatureTabKeyDown(event, "routing-health");
              }}
            >
              <span>Routing + health</span>
              <span aria-hidden="true" className="text-[0.72rem] uppercase tracking-[0.22em] opacity-70">
                05
              </span>
            </button>
          </div>
        </div>

        <article
          id={activeFeaturePanelId}
          className="rounded-lg border border-border-subtle bg-card p-5 shadow-[var(--shadow-soft)] sm:p-6"
          role="tabpanel"
          aria-labelledby={activeFeatureTabId}
        >
          {renderActiveFeature(activeFeatureId)}
        </article>

        <aside
          className="rounded-lg border border-border-subtle bg-surface-subtle p-5 shadow-[var(--shadow-soft)]"
          aria-labelledby="feature-proof-card-title"
        >
          <div className="grid gap-3">
            <h3 id="feature-proof-card-title" className="text-2xl font-medium leading-tight tracking-[-0.05em] text-card-foreground">
              Local HTTPS is a first-class workflow
            </h3>
            <p className="text-sm leading-7 text-muted-foreground">
              Managed Caddy trust and lifecycle commands are exposed directly because local TLS setup is part of the
              product, not a side quest.
            </p>
          </div>
        </aside>
      </div>
    </section>
  );
}

function createFeaturePanelId(featureHighlightId: FeatureHighlightId): string {
  return `feature-panel-${featureHighlightId}`;
}

function createFeatureTabId(featureHighlightId: FeatureHighlightId): string {
  return `feature-tab-${featureHighlightId}`;
}

function createFeatureTabRef(
  featureTabRefs: React.RefObject<Map<FeatureHighlightId, HTMLButtonElement>>,
  featureId: FeatureHighlightId,
): (element: HTMLButtonElement | null) => void {
  return (element: HTMLButtonElement | null): void => {
    if (element === null) {
      featureTabRefs.current.delete(featureId);
      return;
    }

    featureTabRefs.current.set(featureId, element);
  };
}

function findFeatureIndexById(featureId: FeatureHighlightId): number {
  const featureIndex: number = featureTabOrder.indexOf(featureId);

  if (featureIndex === -1) {
    throw new Error(`Missing feature tab for id: ${featureId}`);
  }

  return featureIndex;
}

function readFeatureTabClassName(isActive: boolean): string {
  if (isActive) {
    return "flex w-full items-center justify-between rounded-md border border-transparent bg-primary px-3 py-3 text-left text-sm leading-5 text-primary-foreground shadow-[var(--shadow-soft)]";
  }

  return "flex w-full items-center justify-between rounded-md border border-transparent px-3 py-3 text-left text-sm leading-5 text-muted-foreground transition hover:border-border-subtle hover:bg-surface-subtle hover:text-foreground";
}

function renderActiveFeature(activeFeatureId: FeatureHighlightId): JSX.Element {
  switch (activeFeatureId) {
    case "annotation": {
      return (
        <div className="grid gap-4">
          <h3 className="text-balance text-2xl font-medium leading-tight tracking-[-0.05em] text-card-foreground sm:text-3xl">
            Send annotated page state straight into Pi
          </h3>
          <p className="max-w-[72ch] text-sm leading-7 text-muted-foreground">
            Hold Alt, tag page elements, draft a note, and submit a Pi session seeded with the stack name, page URL,
            selected elements, and component source details when React metadata is available.
          </p>
          <ul className="grid gap-2">
            <li className="rounded-md border border-border-subtle bg-surface-subtle px-3 py-3 text-sm leading-6 text-muted-foreground">
              Mark multiple elements in one draft instead of losing context between screenshots.
            </li>
            <li className="rounded-md border border-border-subtle bg-surface-subtle px-3 py-3 text-sm leading-6 text-muted-foreground">
              Carry component source paths into the handoff when the page exposes them.
            </li>
            <li className="rounded-md border border-border-subtle bg-surface-subtle px-3 py-3 text-sm leading-6 text-muted-foreground">
              Start a coding session from the page itself instead of rewriting the bug report elsewhere.
            </li>
          </ul>
          <FeatureReplay
            demoRecordingUrl="/recordings/marketing/annotation.json"
            featureId="annotation"
            kicker="Annotation handoff"
            title="Send annotated page state straight into Pi"
          />
        </div>
      );
    }
    case "source-jumps": {
      return (
        <div className="grid gap-4">
          <h3 className="text-balance text-2xl font-medium leading-tight tracking-[-0.05em] text-card-foreground sm:text-3xl">
            Editor-aware component jumps
          </h3>
          <p className="max-w-[72ch] text-sm leading-7 text-muted-foreground">
            Alt + right-click component inspection can open the nearest React source in the editor you configured.
          </p>
          <ul className="grid gap-2">
            <li className="rounded-md border border-border-subtle bg-surface-subtle px-3 py-3 text-sm leading-6 text-muted-foreground">
              Jump from the routed page to the nearest component without manually tracing the tree.
            </li>
            <li className="rounded-md border border-border-subtle bg-surface-subtle px-3 py-3 text-sm leading-6 text-muted-foreground">
              Keep source navigation wired to the editor the stack already expects.
            </li>
            <li className="rounded-md border border-border-subtle bg-surface-subtle px-3 py-3 text-sm leading-6 text-muted-foreground">
              Use the inspection loop to move from page evidence into code without re-establishing context.
            </li>
          </ul>
          <FeatureReplay
            demoRecordingUrl="/recordings/marketing/source-jumps.json"
            featureId="source-jumps"
            kicker="Source navigation"
            title="Editor-aware component jumps"
          />
        </div>
      );
    }
    case "sessions": {
      return (
        <div className="grid gap-4">
          <h3 className="text-balance text-2xl font-medium leading-tight tracking-[-0.05em] text-card-foreground sm:text-3xl">
            Keep the editor and agent session attached to the inspection loop
          </h3>
          <p className="max-w-[72ch] text-sm leading-7 text-muted-foreground">
            Component-source jumps and annotation sessions can open embedded terminals, including Neovim, with a
            normalized xterm.js environment so terminal UIs render correctly inside the browser surface.
          </p>
          <ul className="grid gap-2">
            <li className="rounded-md border border-border-subtle bg-surface-subtle px-3 py-3 text-sm leading-6 text-muted-foreground">
              Keep source navigation and editing inside the same inspection flow.
            </li>
            <li className="rounded-md border border-border-subtle bg-surface-subtle px-3 py-3 text-sm leading-6 text-muted-foreground">
              Normalize TERM and color capabilities for browser-backed terminal sessions.
            </li>
            <li className="rounded-md border border-border-subtle bg-surface-subtle px-3 py-3 text-sm leading-6 text-muted-foreground">
              Use the session tray as persistent working memory while you inspect the page.
            </li>
          </ul>
          <FeatureReplay
            demoRecordingUrl="/recordings/marketing/sessions.json"
            featureId="sessions"
            kicker="Terminal sessions"
            title="Keep the editor and agent session attached to the inspection loop"
          />
        </div>
      );
    }
    case "overlay": {
      return (
        <div className="grid gap-4">
          <h3 className="text-balance text-2xl font-medium leading-tight tracking-[-0.05em] text-card-foreground sm:text-3xl">
            Inspect live pages without turning the proxy into a bottleneck
          </h3>
          <p className="max-w-[72ch] text-sm leading-7 text-muted-foreground">
            The injected devtools split document navigation from asset traffic and mount inside a Shadow DOM root, so
            the overlay can inspect the page without polluting the host app&apos;s CSS.
          </p>
          <ul className="grid gap-2">
            <li className="rounded-md border border-border-subtle bg-surface-subtle px-3 py-3 text-sm leading-6 text-muted-foreground">
              Keep HMR, assets, fetches, SSE, and WebSockets off the injection path.
            </li>
            <li className="rounded-md border border-border-subtle bg-surface-subtle px-3 py-3 text-sm leading-6 text-muted-foreground">
              Inject the debugging chrome only where page-level context matters.
            </li>
            <li className="rounded-md border border-border-subtle bg-surface-subtle px-3 py-3 text-sm leading-6 text-muted-foreground">
              Preserve visual isolation between the app and the overlay runtime.
            </li>
          </ul>
          <FeatureReplay
            demoRecordingUrl="/recordings/marketing/overlay.json"
            featureId="overlay"
            kicker="Devtools overlay"
            title="Inspect live pages without turning the proxy into a bottleneck"
          />
        </div>
      );
    }
    default: {
      return (
        <div className="grid gap-4">
          <h3 className="text-balance text-2xl font-medium leading-tight tracking-[-0.05em] text-card-foreground sm:text-3xl">
            Reserve the host, wait for health, then expose the route
          </h3>
          <p className="max-w-[72ch] text-sm leading-7 text-muted-foreground">
            devhost reserves public hosts before the app goes live, waits for each health check to pass, and only then
            reloads the managed Caddy instance so the route becomes real at the correct moment.
          </p>
          <ul className="grid gap-2">
            <li className="rounded-md border border-border-subtle bg-surface-subtle px-3 py-3 text-sm leading-6 text-muted-foreground">
              Use real hostnames instead of juggling localhost ports by hand.
            </li>
            <li className="rounded-md border border-border-subtle bg-surface-subtle px-3 py-3 text-sm leading-6 text-muted-foreground">
              Keep routes aligned with process lifetime so stale hosts disappear automatically.
            </li>
            <li className="rounded-md border border-border-subtle bg-surface-subtle px-3 py-3 text-sm leading-6 text-muted-foreground">
              Expose the hostname only after the service is actually healthy.
            </li>
          </ul>
          <FeatureReplay
            demoRecordingUrl="/recordings/marketing/routing-health.json"
            featureId="routing-health"
            kicker="Routing + health"
            title="Reserve the host, wait for health, then expose the route"
          />
        </div>
      );
    }
  }
}
