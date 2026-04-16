import { useEffect, useRef, useState, type JSX, type PropsWithChildren } from "react";

import {
  createRrwebDemoRecording,
  type IRrwebDemoRecording,
  type IRrwebDemoRecordingController,
} from "../features/rrweb";
import {
  readMarketingRecordingScenario,
  type IMarketingRecordingScenario,
} from "../features/marketingRecording/marketingRecordingScenarios";
import { DevhostMockShell } from "../devhostMock/DevhostMockShell";

declare global {
  interface Window {
    __DEVHOST_MARKETING_CAPTURE__?: IMarketingCaptureWindowApi;
  }
}

interface IMarketingCaptureWindowApi {
  isReady: () => boolean;
  readScenarioId: () => string;
  startRecording: () => boolean;
  stopRecording: () => IRrwebDemoRecording | null;
}

interface ICaptureSourceHint {
  columnNumber: number;
  fileName: string;
  lineNumber: number;
}

interface ICaptureSectionProps {
  description: string;
  eyebrow: string;
  testId?: string;
  title: string;
}

interface ICaptureBrowserChromeProps {
  isRouteLive: boolean;
  scenario: IMarketingRecordingScenario;
}

interface ICaptureCopyCard {
  description: string;
  title: string;
}

interface ILabeledValueProps {
  label: string;
  value: string;
}

interface ICaptureSourceCardSurfaceProps {
  __source: ICaptureSourceHint;
}

interface ICaptureBrowserChromeProps {
  isRouteLive: boolean;
  scenario: IMarketingRecordingScenario;
}

interface ICaptureCopyCard {
  description: string;
  title: string;
}

interface ILabeledValueProps {
  label: string;
  value: string;
}

interface ICaptureSourceCardSurfaceProps {
  __source: ICaptureSourceHint;
}

const interactiveCardClassName: string = [
  "grid gap-3 rounded-3xl border border-border-subtle bg-card/80 p-5 text-left",
  "shadow-[var(--shadow-soft)] backdrop-blur transition duration-200",
  "hover:-translate-y-0.5 hover:border-border-strong hover:bg-card",
].join(" ");

const surfaceCardClassName: string = [
  "grid gap-4 rounded-3xl border border-border-subtle bg-card/80 p-6",
  "shadow-[var(--shadow-soft)] backdrop-blur",
].join(" ");

const statusPillClassName: string = [
  "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]",
  "bg-surface-subtle/80 text-muted-foreground",
].join(" ");

export function MarketingCapturePage(): JSX.Element {
  const activeRecordingControllerReference = useRef<IRrwebDemoRecordingController | null>(null);
  const isReadyReference = useRef<boolean>(false);
  const scenario: IMarketingRecordingScenario | null = readMarketingRecordingScenario(readScenarioIdFromLocation());
  const [isRouteLive, setIsRouteLive] = useState<boolean>(() => {
    return scenario?.routeRevealDelayMs === undefined;
  });

  useEffect(() => {
    if (scenario === null) {
      return;
    }

    const previousTheme: string | undefined = document.documentElement.dataset.theme;
    const previousColorScheme: string = document.documentElement.style.colorScheme;

    document.documentElement.dataset.theme = "dark";
    document.documentElement.style.colorScheme = "dark";
    document.cookie = `devhost-capture-scenario=${scenario.id}; path=/; SameSite=Lax`;

    return (): void => {
      if (previousTheme === undefined) {
        Reflect.deleteProperty(document.documentElement.dataset, "theme");
      } else {
        document.documentElement.dataset.theme = previousTheme;
      }

      document.documentElement.style.colorScheme = previousColorScheme;
      document.cookie = "devhost-capture-scenario=; path=/; max-age=0; SameSite=Lax";
    };
  }, [scenario]);

  useEffect(() => {
    if (scenario === null) {
      return;
    }

    setIsRouteLive(scenario.routeRevealDelayMs === undefined);

    if (scenario.routeRevealDelayMs === undefined) {
      return;
    }

    const timerId: number = window.setTimeout((): void => {
      setIsRouteLive(true);
    }, scenario.routeRevealDelayMs);

    return (): void => {
      window.clearTimeout(timerId);
    };
  }, [scenario]);

  useEffect(() => {
    window.__DEVHOST_MARKETING_CAPTURE__ = {
      isReady(): boolean {
        return isReadyReference.current;
      },
      readScenarioId(): string {
        return scenario?.id ?? "unknown";
      },
      startRecording(): boolean {
        if (activeRecordingControllerReference.current !== null) {
          return false;
        }

        activeRecordingControllerReference.current = createRrwebDemoRecording();
        return true;
      },
      stopRecording(): IRrwebDemoRecording | null {
        const activeRecordingController: IRrwebDemoRecordingController | null =
          activeRecordingControllerReference.current;

        if (activeRecordingController === null) {
          return null;
        }

        activeRecordingControllerReference.current = null;
        return activeRecordingController.stop();
      },
    };

    return (): void => {
      if (activeRecordingControllerReference.current !== null) {
        activeRecordingControllerReference.current.stop();
        activeRecordingControllerReference.current = null;
      }

      Reflect.deleteProperty(window, "__DEVHOST_MARKETING_CAPTURE__");
      isReadyReference.current = false;
    };
  }, [scenario]);

  if (scenario === null) {
    return (
      <div data-testid="MarketingCapturePage">
        <main
          className="grid min-h-dvh place-items-center bg-background px-6 py-12 text-center text-foreground"
          data-testid="MarketingCapturePage--error"
        >
          <div className="max-w-xl rounded-3xl border border-border-subtle bg-card/80 p-8 shadow-[var(--shadow-soft)]">
            <p className={statusPillClassName}>Invalid capture scenario</p>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight">
              This marketing capture scenario does not exist.
            </h1>
            <p className="mt-4 text-sm leading-7 text-muted-foreground">
              Use one of the scenario ids from <code>marketingRecordingScenarios.ts</code> when opening the dev-only
              capture route.
            </p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div data-testid="MarketingCapturePage">
      <DevhostMockShell
        scenarioId={scenario.id}
        onReady={(): void => {
          isReadyReference.current = true;
        }}
      >
        <main className="min-h-dvh bg-background text-foreground" data-testid="MarketingCapturePage--content">
          <div className="mx-auto flex min-h-dvh max-w-[1480px] flex-col gap-8 px-6 py-8 md:px-8 lg:pr-[23rem] xl:px-10">
            <CaptureBrowserChrome isRouteLive={isRouteLive} scenario={scenario} />

            <section className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
              <div className={surfaceCardClassName}>
                <p className={statusPillClassName}>Deterministic rrweb capture</p>
                <h1 className="text-4xl font-semibold tracking-tight text-foreground">{scenario.label}</h1>
                <p className="max-w-[58ch] text-sm leading-7 text-muted-foreground">
                  This dev-only route exists solely to regenerate the marketing replay JSONs from a fixed viewport,
                  stable fixtures, and the live devhost devtools UI.
                </p>
                <div className="grid gap-4 md:grid-cols-3">
                  <CaptureFact label="Viewport" value={`${scenario.viewport.width} × ${scenario.viewport.height}`} />
                  <CaptureFact label="Theme" value="Dark" />
                  <CaptureFact label="Replay target" value={scenario.recordingFileName} />
                </div>
              </div>

              <section className={surfaceCardClassName} data-testid="MarketingCapturePage--route-status-card">
                <p className={statusPillClassName}>{isRouteLive ? "Route live" : "Waiting for health gate"}</p>
                <h2 className="text-2xl font-semibold tracking-tight">https://app.localhost/dashboard</h2>
                <p className="text-sm leading-7 text-muted-foreground">
                  {isRouteLive
                    ? "The primary route is now healthy and available through the managed local edge."
                    : "The primary route stays dark until the app reports healthy and the edge gate clears."}
                </p>
                <button
                  className={[
                    "inline-flex h-11 items-center justify-center rounded-xl border px-4 text-sm font-medium transition",
                    isRouteLive
                      ? "border-transparent bg-primary text-primary-foreground shadow-[var(--shadow-soft)] hover:-translate-y-px"
                      : "cursor-not-allowed border-border-subtle bg-surface-subtle text-muted-foreground",
                  ].join(" ")}
                  data-testid="MarketingCapturePage--route-live-button"
                  disabled={!isRouteLive}
                  type="button"
                >
                  {isRouteLive ? "Open routed app" : "Health gate pending"}
                </button>
              </section>
            </section>

            {isRouteLive ? (
              <>
                <section className="grid gap-4 lg:grid-cols-3">
                  <button
                    className={interactiveCardClassName}
                    data-testid="MarketingCapturePage--annotation-target-primary"
                    type="button"
                  >
                    <p className={statusPillClassName}>Annotation target</p>
                    <strong className="text-lg font-semibold">Route rollout checklist</strong>
                    <p className="text-sm leading-7 text-muted-foreground">
                      Pin the rollout note beneath the health badge and keep the status wording concise.
                    </p>
                  </button>
                  <button
                    className={interactiveCardClassName}
                    data-testid="MarketingCapturePage--annotation-target-secondary"
                    type="button"
                  >
                    <p className={statusPillClassName}>Annotation target</p>
                    <strong className="text-lg font-semibold">Launch command rail</strong>
                    <p className="text-sm leading-7 text-muted-foreground">
                      Keep the call-to-action aligned with the rollout note while the route badge is still visible.
                    </p>
                  </button>
                  <CaptureSourceCard />
                </section>

                <section className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
                  <CaptureSection
                    description="A deliberately busy surface so the overlay, annotation markers, and terminal tray stay readable on top of the host app."
                    eyebrow="Host page"
                    title="Operations overview"
                  >
                    <div className="grid gap-3 md:grid-cols-2">
                      <CaptureMetricCard label="Healthy routes" value="3" />
                      <CaptureMetricCard label="Queued notes" value="2" />
                      <CaptureMetricCard label="Source jumps" value="Ready" />
                      <CaptureMetricCard label="Terminal state" value="Attached" />
                    </div>
                    <div className="grid gap-3 lg:grid-cols-2">
                      <button
                        className={interactiveCardClassName}
                        data-testid="MarketingCapturePage--terminal-card"
                        type="button"
                      >
                        <p className={statusPillClassName}>Terminal workflow</p>
                        <strong className="text-lg font-semibold">Neovim session handoff</strong>
                        <p className="text-sm leading-7 text-muted-foreground">
                          Jump from the routed page into the component source without leaving the browser workflow.
                        </p>
                      </button>
                      <div className={[interactiveCardClassName, "cursor-default"].join(" ")}>
                        <p className={statusPillClassName}>Evidence</p>
                        <strong className="text-lg font-semibold">Captured context</strong>
                        <p className="text-sm leading-7 text-muted-foreground">
                          Browser URL, title, selected elements, and source hints stay attached to the annotation
                          handoff.
                        </p>
                      </div>
                    </div>
                  </CaptureSection>

                  <CaptureSection
                    description="Extra depth in the page so the overlay capture can scroll while the fixed devtools chrome stays in place."
                    eyebrow="Scroll target"
                    testId="MarketingCapturePage--scroll-section"
                    title="Release notes"
                  >
                    <div className="grid gap-3">
                      {releaseNoteRows.map((row) => {
                        return (
                          <div
                            key={row.title}
                            className="rounded-2xl border border-border-subtle bg-surface-subtle/70 p-4"
                          >
                            <strong className="text-sm font-semibold text-foreground">{row.title}</strong>
                            <p className="mt-2 text-sm leading-7 text-muted-foreground">{row.description}</p>
                          </div>
                        );
                      })}
                    </div>
                  </CaptureSection>
                </section>

                <section className="grid gap-6 xl:grid-cols-2">
                  <CaptureSection
                    description="This long-form area helps the replay show real document scrolling while the overlay remains docked to the browser edge."
                    eyebrow="Evidence lane"
                    title="Context snapshots"
                  >
                    <div className="grid gap-4 md:grid-cols-2">
                      {contextSnapshotCards.map((card) => {
                        return (
                          <div
                            key={card.title}
                            className="rounded-3xl border border-border-subtle bg-card/70 p-5 shadow-[var(--shadow-soft)]"
                          >
                            <strong className="text-base font-semibold text-foreground">{card.title}</strong>
                            <p className="mt-2 text-sm leading-7 text-muted-foreground">{card.description}</p>
                          </div>
                        );
                      })}
                    </div>
                  </CaptureSection>

                  <CaptureSection
                    description="Purpose-built notes that keep the page tall enough for consistent overlay and minimap captures."
                    eyebrow="Depth"
                    title="Runbook excerpts"
                  >
                    <div className="space-y-4">
                      {runbookNotes.map((note) => {
                        return (
                          <div
                            key={note}
                            className="rounded-2xl border border-border-subtle bg-surface-subtle/70 p-4 text-sm leading-7 text-muted-foreground"
                          >
                            {note}
                          </div>
                        );
                      })}
                    </div>
                  </CaptureSection>
                </section>
              </>
            ) : (
              <section className={surfaceCardClassName} data-testid="MarketingCapturePage--route-gate">
                <p className={statusPillClassName}>Pre-health state</p>
                <h2 className="text-3xl font-semibold tracking-tight">The routed hostname is still held back.</h2>
                <p className="max-w-[52ch] text-sm leading-7 text-muted-foreground">
                  The browser already knows where the app should live, but the edge waits until the app reports healthy
                  before exposing the route and switching to the live dashboard surface.
                </p>
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4">
                    <strong className="text-sm font-semibold text-foreground">Primary app</strong>
                    <p className="mt-2 text-sm leading-7 text-muted-foreground">Health probe still pending.</p>
                  </div>
                  <div className="rounded-2xl border border-border-subtle bg-surface-subtle/70 p-4">
                    <strong className="text-sm font-semibold text-foreground">API service</strong>
                    <p className="mt-2 text-sm leading-7 text-muted-foreground">Ready and waiting on the edge gate.</p>
                  </div>
                  <div className="rounded-2xl border border-border-subtle bg-surface-subtle/70 p-4">
                    <strong className="text-sm font-semibold text-foreground">Worker</strong>
                    <p className="mt-2 text-sm leading-7 text-muted-foreground">Consuming replay fixture updates.</p>
                  </div>
                </div>
              </section>
            )}
          </div>
        </main>
      </DevhostMockShell>
    </div>
  );
}

function CaptureBrowserChrome({ isRouteLive, scenario }: ICaptureBrowserChromeProps): JSX.Element {
  return (
    <section className="rounded-[2rem] border border-border-subtle bg-card/80 p-4 shadow-[var(--shadow-soft)] backdrop-blur">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-red-400/90" />
          <span className="h-3 w-3 rounded-full bg-amber-300/90" />
          <span className="h-3 w-3 rounded-full bg-emerald-400/90" />
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-3 rounded-full border border-border-subtle bg-background/80 px-4 py-2 text-sm text-muted-foreground">
          <span className="rounded-full bg-primary/10 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
            {scenario.label}
          </span>
          <span className="truncate">https://app.localhost/dashboard</span>
          <span className={statusPillClassName}>{isRouteLive ? "Live" : "Gate pending"}</span>
        </div>
      </div>
    </section>
  );
}

function CaptureSection(props: PropsWithChildren<ICaptureSectionProps>): JSX.Element {
  return (
    <section className={surfaceCardClassName} data-testid={props.testId}>
      <div className="grid gap-2">
        <p className={statusPillClassName}>{props.eyebrow}</p>
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">{props.title}</h2>
        <p className="text-sm leading-7 text-muted-foreground">{props.description}</p>
      </div>
      {props.children}
    </section>
  );
}

function CaptureFact({ label, value }: ILabeledValueProps): JSX.Element {
  return (
    <div className="rounded-2xl border border-border-subtle bg-surface-subtle/70 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <strong className="mt-2 block text-base font-semibold text-foreground">{value}</strong>
    </div>
  );
}

function CaptureMetricCard({ label, value }: ILabeledValueProps): JSX.Element {
  return (
    <div className="rounded-2xl border border-border-subtle bg-surface-subtle/70 p-4 shadow-[var(--shadow-soft)]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <strong className="mt-2 block text-2xl font-semibold text-foreground">{value}</strong>
    </div>
  );
}

function CaptureSourceCard(): JSX.Element {
  const sourceCardProps: ICaptureSourceCardSurfaceProps = {
    __source: {
      columnNumber: 5,
      fileName: "/Users/alex/development/projects/devhost/packages/www/src/marketingCapture/MarketingCapturePage.tsx",
      lineNumber: 306,
    },
  };

  return <CaptureSourceCardSurface {...sourceCardProps} />;
}

function CaptureSourceCardSurface({ __source }: ICaptureSourceCardSurfaceProps): JSX.Element {
  void __source;

  return (
    <div data-testid="CaptureSourceCardSurface">
      <button className={interactiveCardClassName} data-testid="CaptureSourceCardSurface--source-card" type="button">
        <p className={statusPillClassName}>Source jump target</p>
        <strong className="text-lg font-semibold">Capture source card</strong>
        <p className="text-sm leading-7 text-muted-foreground">
          Alt + right-click this card to open the nearest React source location in the mocked Neovim session.
        </p>
        <code className="rounded-xl border border-border-subtle bg-background/80 px-3 py-2 text-left text-xs text-muted-foreground">
          src/marketingCapture/MarketingCapturePage.tsx
        </code>
      </button>
    </div>
  );
}

function readScenarioIdFromLocation(): string | null {
  return new URL(window.location.href).searchParams.get("scenario");
}

const releaseNoteRows: ReadonlyArray<ICaptureCopyCard> = [
  {
    title: "Local edge stability",
    description:
      "Certificates, host reservations, and health-gated route exposure now settle before the routed hostname flips live.",
  },
  {
    title: "Annotation continuity",
    description:
      "Selected UI evidence, page metadata, and agent handoff notes now survive the same browser workflow without copying state elsewhere.",
  },
  {
    title: "Browser-side terminal loop",
    description:
      "Neovim and agent sessions stay attached to the inspection loop so the route, source file, and terminal surface remain connected.",
  },
  {
    title: "Shadow DOM isolation",
    description:
      "Injected devtools styling stays encapsulated while the host page continues to render its own typography, spacing, and layout rules.",
  },
];

const contextSnapshotCards: ReadonlyArray<ICaptureCopyCard> = [
  {
    title: "Routed hostname",
    description:
      "Keep the final replay grounded in a real local domain instead of a raw localhost port so the overlay feels connected to an actual app.",
  },
  {
    title: "Source-aware markers",
    description:
      "Annotation markers preserve their nearest React source hints when the host app exposes that metadata in development builds.",
  },
  {
    title: "Terminal tray recovery",
    description:
      "Expanded editor sessions can be minimized into the tray and restored later without dropping the browser-side workflow context.",
  },
  {
    title: "Health timeline",
    description:
      "The service panel and log minimap tell the same story as the host page state while the route waits behind the health gate.",
  },
];

const runbookNotes: readonly string[] = [
  "Keep the viewport fixed, the theme stable, and the host data deterministic so replay diffs mostly reflect the devtools UI itself.",
  "Drive cursor motion semantically from stable targets. Layout shifts should not require hand-rebuilding the recording path.",
  "Regenerate rrweb JSONs whenever the overlay visuals or browser workflow meaningfully change. The replays are generated artifacts, not source truth.",
  "Leave the final visual state on screen long enough for the replay tabs in the marketing page to communicate the outcome without narration.",
];
