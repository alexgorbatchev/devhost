import React, { useEffect, useRef, useState, type ChangeEvent, type JSX, type KeyboardEvent } from "react";

import "./App.css";
import { RrwebDemoPanel } from "./RrwebDemoPanel";
import {
  createRrwebDemoRecording,
  type IRrwebDemoRecording,
  type IRrwebDemoRecordingController,
} from "./createRrwebDemoRecording";
import { exportRrwebDemoRecording } from "./exportRrwebDemoRecording";
import { loadRrwebDemoRecording } from "./loadRrwebDemoRecording";
import type {
  FeatureHighlightId,
  IFeatureHighlight,
  IProofCard,
  IThemeOption,
  IWorkflowStep,
  ProofCardId,
  ThemePreference,
} from "./types";

const themeStorageKey: string = "devhost-test-theme";
const themeOptions: IThemeOption[] = [
  { label: "System", value: "system" },
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
];
const launchCommands: string[] = ["bun devhost caddy start", "bun devhost --manifest ./test/devhost.toml"];
const featureHighlights: IFeatureHighlight[] = [
  {
    body:
      "devhost reserves public hosts before the app goes live, waits for each health check to pass," +
      " and only then reloads the managed Caddy instance.",
    checklist: [
      "Use real hostnames instead of juggling localhost ports by hand.",
      "Keep routes aligned with process lifetime so stale hosts disappear automatically.",
      "Avoid exposing half-ready services just because the child process started.",
    ],
    id: "routing",
    kicker: "Managed routing",
    title: "Route the app only after it is actually healthy",
  },
  {
    body:
      "Routes are held back until the service passes its configured health check," +
      " which is the only sane time to expose a hostname.",
    checklist: [],
    id: "health-checks",
    kicker: "Release discipline",
    title: "Health checks gate exposure",
  },
  {
    body:
      "The injected devtools split document navigation from asset traffic and mount inside a Shadow DOM root," +
      " so the overlay can inspect the page without polluting the host app's CSS.",
    checklist: [
      "Keep HMR, assets, fetches, SSE, and WebSockets off the injection path.",
      "Inject the debugging chrome only where page-level context matters.",
      "Preserve visual isolation between the app and the overlay runtime.",
    ],
    id: "overlay",
    kicker: "Devtools overlay",
    title: "Inspect live pages without turning the proxy into a bottleneck",
  },
  {
    body:
      "Hold Alt, tag page elements, draft a note, and submit a Pi session seeded with the stack name, page URL," +
      " selected elements, and component source details when React metadata is available.",
    checklist: [
      "Mark multiple elements in one draft instead of losing context between screenshots.",
      "Carry component source paths into the handoff when the page exposes them.",
      "Start a coding session from the page itself instead of rewriting the bug report elsewhere.",
    ],
    id: "annotation",
    kicker: "Annotation handoff",
    title: "Send annotated page state straight into Pi",
  },
  {
    body: "Alt + right-click component inspection can open the nearest React source in the editor you configured.",
    checklist: [
      "Jump from the routed page to the nearest component without manually tracing the tree.",
      "Keep source navigation wired to the editor the stack already expects.",
      "Use the inspection loop to move from page evidence into code without re-establishing context.",
    ],
    id: "source-jumps",
    kicker: "Source navigation",
    title: "Editor-aware component jumps",
  },
  {
    body:
      "Component-source jumps and annotation sessions can open embedded terminals, including Neovim, with a" +
      " normalized xterm.js environment so terminal UIs render correctly inside the browser surface.",
    checklist: [
      "Keep source navigation and editing inside the same inspection flow.",
      "Normalize TERM and color capabilities for browser-backed terminal sessions.",
      "Use the session tray as persistent working memory while you inspect the page.",
    ],
    id: "sessions",
    kicker: "Terminal sessions",
    title: "Keep the editor and agent session attached to the inspection loop",
  },
  {
    body: "The manifest resolves ports, hostnames, dependencies, and optional agent configuration in one place.",
    checklist: [],
    id: "stack-contract",
    kicker: "Stack contract",
    title: "One file defines the local stack",
  },
];
const workflowSteps: IWorkflowStep[] = [
  {
    body: "Start the managed Caddy instance once so devhost can own route registration and local TLS.",
    step: "01",
    title: "Boot the managed edge",
  },
  {
    body: "Launch one service or a whole manifest and let devhost resolve ports, dependencies, and health checks.",
    step: "02",
    title: "Run the stack from a manifest",
  },
  {
    body: "Open the routed hostname and inspect the real page with source-aware devtools layered on top.",
    step: "03",
    title: "Work on the routed host",
  },
  {
    body: "Annotate the page, jump to source, or spawn a terminal session without leaving the browser loop.",
    step: "04",
    title: "Hand off context without rewriting it",
  },
];
const proofCards: IProofCard[] = [
  {
    body: "Document navigations are injected, but assets and hot-reload traffic stay on the direct app path.",
    eyebrow: "Proxy discipline",
    id: "proxy-discipline",
    title: "Devtools stay off the noisy traffic",
  },
  {
    body: "The overlay lives inside its own Shadow DOM container so host styles do not quietly corrupt the tooling UI.",
    eyebrow: "Isolation",
    id: "isolation",
    title: "The debugging shell is visually contained",
  },
  {
    body:
      "Managed Caddy trust and lifecycle commands are exposed directly because local TLS setup is part of the" +
      " product, not a side quest.",
    eyebrow: "Operational honesty",
    id: "local-https",
    title: "Local HTTPS is a first-class workflow",
  },
];
const featureSectionProofCardId: ProofCardId = "local-https";
const featureSectionProofCard: IProofCard = findProofCardById(featureSectionProofCardId);
const proofGridCards: IProofCard[] = proofCards.filter((proofCard: IProofCard): boolean => {
  return proofCard.id !== featureSectionProofCardId;
});
const manifestPreviewLines: string[] = [
  'name = "hello-test-app"',
  'primaryService = "hello"',
  'devtoolsPosition = "top-right"',
  'devtoolsComponentEditor = "neovim"',
  "",
  "[services.hello]",
  'command = ["bun", "dev"]',
  "port = 3200",
  'host = "hello.xcv.lol"',
  "",
  "[services.logs.health]",
  "process = true",
];

export interface IAppProps {
  initialRecordingUrl?: string | null;
  isDevelopmentMode?: boolean;
}

export function App(props: IAppProps): JSX.Element {
  const activeRecordingControllerRef = useRef<IRrwebDemoRecordingController | null>(null);
  const [activeFeatureId, setActiveFeatureId] = useState<FeatureHighlightId>("routing");
  const [isRecordingRrwebDemo, setIsRecordingRrwebDemo] = useState<boolean>(false);
  const [rrwebDemoRecording, setRrwebDemoRecording] = useState<IRrwebDemoRecording | null>(null);
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => {
    return readStoredThemePreference(window.localStorage);
  });
  const activeFeature: IFeatureHighlight = findFeatureHighlightById(activeFeatureId);
  const activeFeaturePanelId: string = createFeaturePanelId(activeFeatureId);
  const activeFeatureTabId: string = createFeatureTabId(activeFeatureId);
  const featureTabRefs = useRef<Map<FeatureHighlightId, HTMLButtonElement>>(new Map());
  const initialRecordingUrl: string | null = props.initialRecordingUrl ?? null;
  const isDevelopmentMode: boolean = props.isDevelopmentMode ?? false;
  const shouldShowRrwebPanel: boolean =
    initialRecordingUrl !== null || isDevelopmentMode || rrwebDemoRecording !== null;

  function handleFeatureTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, featureIndex: number): void {
    const lastFeatureIndex: number = featureHighlights.length - 1;

    let nextFeatureIndex: number | null = null;

    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight": {
        nextFeatureIndex = featureIndex === lastFeatureIndex ? 0 : featureIndex + 1;
        break;
      }
      case "ArrowLeft":
      case "ArrowUp": {
        nextFeatureIndex = featureIndex === 0 ? lastFeatureIndex : featureIndex - 1;
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

    const nextFeature = featureHighlights[nextFeatureIndex];

    if (nextFeature === undefined) {
      return;
    }

    setActiveFeatureId(nextFeature.id);
    featureTabRefs.current.get(nextFeature.id)?.focus();
  }

  function handleStartRrwebRecording(): void {
    if (isRecordingRrwebDemo) {
      return;
    }

    activeRecordingControllerRef.current = createRrwebDemoRecording();
    setRrwebDemoRecording(null);
    setIsRecordingRrwebDemo(true);
  }

  function handleStopRrwebRecording(): void {
    const activeRecordingController = activeRecordingControllerRef.current;

    if (activeRecordingController === null) {
      return;
    }

    const recording = activeRecordingController.stop();

    activeRecordingControllerRef.current = null;
    setIsRecordingRrwebDemo(false);
    setRrwebDemoRecording(recording);
  }

  function handleExportRrwebRecording(): void {
    if (rrwebDemoRecording === null) {
      return;
    }

    exportRrwebDemoRecording(rrwebDemoRecording);
  }

  useEffect(() => {
    return (): void => {
      const activeRecordingController = activeRecordingControllerRef.current;

      if (activeRecordingController !== null) {
        activeRecordingController.stop();
        activeRecordingControllerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (initialRecordingUrl === null) {
      return;
    }

    let isCancelled = false;

    void loadRrwebDemoRecording(initialRecordingUrl)
      .then((recording: IRrwebDemoRecording | null): void => {
        if (isCancelled || recording === null || activeRecordingControllerRef.current !== null) {
          return;
        }

        setRrwebDemoRecording((currentRecording: IRrwebDemoRecording | null): IRrwebDemoRecording | null => {
          return currentRecording ?? recording;
        });
      })
      .catch((error: unknown): void => {
        console.error(error);
      });

    return (): void => {
      isCancelled = true;
    };
  }, [initialRecordingUrl]);

  useEffect((): void => {
    document.documentElement.dataset.theme = themePreference;
    window.localStorage.setItem(themeStorageKey, themePreference);
  }, [themePreference]);

  return (
    <main className="app-shell" data-testid="App">
      <div className="app-frame">
        <header className="app-topbar">
          <div className="brand-lockup">
            <p className="brand-lockup__eyebrow">devhost</p>
            <p className="brand-lockup__caption">Managed Caddy, routed hosts, source-aware devtools</p>
          </div>

          <label className="theme-control" htmlFor="theme-preference">
            <span className="theme-control__label">Theme</span>
            <select
              id="theme-preference"
              className="theme-control__select"
              value={themePreference}
              onChange={(event: ChangeEvent<HTMLSelectElement>): void => {
                setThemePreference(parseThemePreference(event.currentTarget.value));
              }}
            >
              {themeOptions.map((themeOption: IThemeOption) => {
                return (
                  <option key={themeOption.value} value={themeOption.value}>
                    {themeOption.label}
                  </option>
                );
              })}
            </select>
          </label>
        </header>

        <section className="hero-section" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="panel-kicker">Managed local stacks behind real hosts</p>
            <h1 id="hero-title" className="app-title">
              devhost is the storefront for routed local stacks.
            </h1>
            <p className="app-body">
              Start the app, wait for health, route a real hostname through managed Caddy, and layer source-aware
              devtools on top without dragging every asset request through the proxy.
            </p>
            <ul className="hero-bullets">
              <li>Manifest mode when the stack has real dependencies.</li>
              <li>Annotation, source navigation, and terminal sessions from the page itself.</li>
            </ul>
          </div>

          <aside className="hero-panel" aria-labelledby="hero-panel-title">
            <p className="panel-kicker">Launch sequence</p>
            <h2 id="hero-panel-title" className="section-title">
              From clean boot to routed app in two commands.
            </h2>
            <div className="command-stack">
              {launchCommands.map((command: string) => {
                return (
                  <pre key={command} className="command-card">
                    <code>{command}</code>
                  </pre>
                );
              })}
            </div>
            <ul className="bullet-list">
              <li>Start the managed edge once, then let devhost own route registration.</li>
              <li>Run the manifest and let health checks decide when a hostname becomes real.</li>
              <li>Open the routed page with devtools that understand the stack around it.</li>
            </ul>
          </aside>
        </section>

        {shouldShowRrwebPanel ? (
          <section className="demo-band" aria-label="Live replay demo">
            <RrwebDemoPanel
              isDevelopmentMode={isDevelopmentMode}
              isRecording={isRecordingRrwebDemo}
              onExportRecording={handleExportRrwebRecording}
              onStartRecording={handleStartRrwebRecording}
              onStopRecording={handleStopRrwebRecording}
              recording={rrwebDemoRecording}
            />
          </section>
        ) : null}

        <section className="feature-section" aria-labelledby="feature-section-title">
          <div className="section-intro">
            <p className="panel-kicker">What you are buying</p>
            <h2 id="feature-section-title" className="section-title">
              A routed development surface, not another localhost wrapper.
            </h2>
            <p className="section-body">
              The point is not to proxy everything. The point is to expose the right host, keep the stack honest, and
              put the debugging workflow where the page already lives.
            </p>
          </div>

          <div className="feature-layout">
            <div
              className="feature-tab-list"
              role="tablist"
              aria-label="Devhost product highlights"
              aria-orientation="vertical"
            >
              {featureHighlights.map((featureHighlight: IFeatureHighlight, featureIndex: number) => {
                const isActive: boolean = featureHighlight.id === activeFeatureId;
                const featurePanelId: string = createFeaturePanelId(featureHighlight.id);
                const featureTabId: string = createFeatureTabId(featureHighlight.id);

                return (
                  <button
                    key={featureHighlight.id}
                    id={featureTabId}
                    ref={(element: HTMLButtonElement | null): void => {
                      if (element === null) {
                        featureTabRefs.current.delete(featureHighlight.id);
                        return;
                      }

                      featureTabRefs.current.set(featureHighlight.id, element);
                    }}
                    type="button"
                    role="tab"
                    className="feature-button"
                    aria-controls={featurePanelId}
                    aria-selected={isActive}
                    tabIndex={isActive ? 0 : -1}
                    onClick={(): void => {
                      setActiveFeatureId(featureHighlight.id);
                    }}
                    onKeyDown={(event: KeyboardEvent<HTMLButtonElement>): void => {
                      handleFeatureTabKeyDown(event, featureIndex);
                    }}
                  >
                    {featureHighlight.kicker}
                  </button>
                );
              })}
            </div>

            <article
              id={activeFeaturePanelId}
              className="feature-detail"
              role="tabpanel"
              aria-labelledby={activeFeatureTabId}
            >
              <p className="panel-kicker">{activeFeature.kicker}</p>
              <h3 className="section-title">{activeFeature.title}</h3>
              <p className="section-body">{activeFeature.body}</p>
              {activeFeature.checklist.length > 0 ? (
                <ul className="bullet-list">
                  {activeFeature.checklist.map((checklistItem: string) => {
                    return <li key={checklistItem}>{checklistItem}</li>;
                  })}
                </ul>
              ) : null}
            </article>

            <aside className="proof-card feature-proof-card" aria-labelledby="feature-proof-card-title">
              <p className="panel-kicker">{featureSectionProofCard.eyebrow}</p>
              <h3 id="feature-proof-card-title" className="proof-card__title">
                {featureSectionProofCard.title}
              </h3>
              <p className="proof-card__body">{featureSectionProofCard.body}</p>
            </aside>
          </div>
        </section>

        <section className="workflow-section" aria-labelledby="workflow-section-title">
          <div className="section-intro">
            <p className="panel-kicker">Workflow</p>
            <h2 id="workflow-section-title" className="section-title">
              Give the stack a disciplined path from boot to inspection.
            </h2>
            <p className="section-body">
              This is where devhost earns its keep: boot the edge, resolve the stack, route the host, then keep the
              debugging workflow close enough to the page that context does not leak away.
            </p>
          </div>

          <div className="workflow-layout">
            <div className="workflow-stack">
              {workflowSteps.map((workflowStep: IWorkflowStep) => {
                return (
                  <article key={workflowStep.step} className="workflow-card">
                    <p className="workflow-card__step">{workflowStep.step}</p>
                    <div className="workflow-card__content">
                      <h3 className="workflow-card__title">{workflowStep.title}</h3>
                      <p className="workflow-card__body">{workflowStep.body}</p>
                    </div>
                  </article>
                );
              })}
            </div>

            <aside className="manifest-card" aria-labelledby="manifest-card-title">
              <p className="panel-kicker">Manifest preview</p>
              <h2 id="manifest-card-title" className="section-title">
                The demo app now reads like product evidence.
              </h2>
              <p className="section-body">
                The sample manifest is still the fastest way to explain what devhost owns: stack identity, primary
                routing, devtools placement, editor preference, and service-level process contracts.
              </p>
              <pre className="manifest-preview">
                <code>{manifestPreviewLines.join("\n")}</code>
              </pre>
            </aside>
          </div>
        </section>

        <section className="proof-section" aria-labelledby="proof-section-title">
          <div className="section-intro">
            <p className="panel-kicker">Why this shell is credible</p>
            <h2 id="proof-section-title" className="section-title">
              The page now sells the real constraints, not decorative abstractions.
            </h2>
          </div>

          <div className="proof-grid">
            {proofGridCards.map((proofCard: IProofCard) => {
              return (
                <article key={proofCard.id} className="proof-card">
                  <p className="panel-kicker">{proofCard.eyebrow}</p>
                  <h3 className="proof-card__title">{proofCard.title}</h3>
                  <p className="proof-card__body">{proofCard.body}</p>
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}

function createFeatureTabId(featureHighlightId: FeatureHighlightId): string {
  return `feature-tab-${featureHighlightId}`;
}

function createFeaturePanelId(featureHighlightId: FeatureHighlightId): string {
  return `feature-panel-${featureHighlightId}`;
}

function readStoredThemePreference(storage: Pick<Storage, "getItem">): ThemePreference {
  return parseThemePreference(storage.getItem(themeStorageKey));
}

function parseThemePreference(value: string | null): ThemePreference {
  if (value === "system" || value === "light" || value === "dark") {
    return value;
  }

  return "system";
}

function findProofCardById(proofCardId: ProofCardId): IProofCard {
  const proofCard: IProofCard | undefined = proofCards.find((candidateProofCard: IProofCard): boolean => {
    return candidateProofCard.id === proofCardId;
  });

  if (proofCard === undefined) {
    throw new Error(`Missing proof card for id: ${proofCardId}`);
  }

  return proofCard;
}

function findFeatureHighlightById(activeFeatureId: FeatureHighlightId): IFeatureHighlight {
  const activeFeature: IFeatureHighlight | undefined = featureHighlights.find(
    (featureHighlight: IFeatureHighlight): boolean => {
      return featureHighlight.id === activeFeatureId;
    },
  );

  if (activeFeature === undefined) {
    throw new Error(`Missing feature highlight for id: ${activeFeatureId}`);
  }

  return activeFeature;
}
