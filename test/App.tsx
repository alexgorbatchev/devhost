import { useEffect, useRef, useState, type ChangeEvent, type JSX } from "react";

import "./App.css";
import { RrwebDemoPanel } from "./RrwebDemoPanel";
import {
  createRrwebDemoRecording,
  type IRrwebDemoRecording,
  type IRrwebDemoRecordingController,
} from "./createRrwebDemoRecording";
import { exportRrwebDemoRecording } from "./exportRrwebDemoRecording";
import type {
  IAuditMetric,
  IAuditSection,
  IDiagnosticSection,
  IInspectionLane,
  IThemeOption,
  InspectionLaneId,
  ThemePreference,
} from "./types";

const themeStorageKey: string = "devhost-test-theme";
const themeOptions: IThemeOption[] = [
  { label: "System", value: "system" },
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
];
const auditMetrics: IAuditMetric[] = [
  { label: "Base viewport", value: "1920 px" },
  { label: "Header", value: "72 px" },
  { label: "Grid", value: "4 px" },
  { label: "Modes", value: "3" },
];
const inspectionLanes: IInspectionLane[] = [
  {
    body:
      "Dark mode remains the reference surface because that is what the Framer skill asked for." +
      " Light mode exists now only as an explicit comparison path, so token drift and contrast regressions" +
      " become easier to catch.",
    checklist: [
      "Confirm dark mode still uses the black base and restrained raised surfaces.",
      "Switch to light mode and verify it becomes a real token change rather than a mislabeled dark theme.",
      "Use system mode and confirm the page follows the browser preference after reload.",
    ],
    id: "shell",
    kicker: "Theme parity",
    title: "Theme switching is real again",
  },
  {
    body:
      "The typography stays intentionally large in both themes." +
      " If overlays become hard to read only after switching themes, that exposes a real contrast failure" +
      " instead of a styling preference.",
    checklist: [
      "Read the hero copy in dark mode without zooming or squinting.",
      "Switch to light mode and compare muted labels against the brighter surface.",
      "Open devhost chrome and confirm it does not wash out either reading layer.",
    ],
    id: "contrast",
    kicker: "Contrast sanity",
    title: "Contrast survives the theme change",
  },
  {
    body:
      "The document is still tall on purpose." +
      " Fixed controls, minimaps, and annotations should feel attached to the viewport" +
      " whether the page is currently dark or light.",
    checklist: [
      "Scroll from top to bottom in dark mode and watch whether fixed overlays drift visually.",
      "Repeat in light mode so the background shift cannot hide spacing or anchoring defects.",
      "Check the lower sections for any collapse in spacing rhythm or panel hierarchy.",
    ],
    id: "scroll",
    kicker: "Scroll depth",
    title: "Scroll depth stays attached",
  },
];
const auditSections: IAuditSection[] = [
  {
    body:
      "Dark mode is still the primary Framer-style reference surface," +
      " but the app now carries a separate light token set." +
      " That is an explicit override, not an accident, and it makes theme regressions testable.",
    eyebrow: "Color contract",
    title: "Reference dark mode with a deliberate light override",
  },
  {
    body:
      "The hero keeps the 93 px heading and 23 px body copy at the base viewport in both themes." +
      " Large type exposes wrap, spacing, and overlay collisions faster than decorative motion ever will.",
    eyebrow: "Typography contract",
    title: "Readable scale stays constant across themes",
  },
  {
    body:
      "The theme control uses a visible 2 px focus ring, clear labeling, and persistent state." +
      " A control that changes the whole shell should never rely on vague hover styling to explain itself.",
    eyebrow: "Interaction contract",
    title: "Theme control is explicit and testable",
  },
];
const diagnosticSections: IDiagnosticSection[] = [
  {
    paragraphs: [
      "This section exists to validate that top chrome remains visually attached to the viewport while the document" +
        " grows below it.",
      "If a minimap or annotation rail looks like it floats away during scroll, that is a layout issue and not a" +
        " theme issue.",
    ],
    title: "Viewport anchoring",
  },
  {
    paragraphs: [
      "Long-form copy is intentionally calmer than the shell around it." +
        " A reading pane should never compete with inspection chrome for attention.",
      "If visual fatigue appears in one theme but not the other, the token system is inconsistent and needs fixing.",
    ],
    title: "Reading comfort",
  },
  {
    paragraphs: [
      "Muted labels stay restrained while body text stays much stronger." +
        " That separation should remain obvious in both the dark reference mode and the restored light mode.",
      "If labels and body copy collapse into the same apparent weight, the hierarchy is wrong.",
    ],
    title: "Muted hierarchy",
  },
  {
    paragraphs: [
      "The cards below keep the 4 px grid intact with deliberate 24 px and 32 px jumps." +
        " Random spacing values would make the shell look improvised instead of governed.",
      "That matters because sloppy spacing makes overlay debugging harder than it needs to be.",
    ],
    title: "Spacing rhythm",
  },
  {
    paragraphs: [
      "The lane selector and the theme selector both use visible focus treatment and explicit state." +
        " Nothing here depends on a hover gimmick to explain which control is active.",
      "If users cannot tell the current mode from still pixels, the control is wrong.",
    ],
    title: "State clarity",
  },
  {
    paragraphs: [
      "This final section pushes the document deep enough to judge top, middle, and bottom scroll positions with the" +
        " same visual language.",
      "A real test surface should not become less trustworthy just because you reached the lower half of the page.",
    ],
    title: "Depth confidence",
  },
];

export function App(): JSX.Element {
  const activeRecordingControllerRef = useRef<IRrwebDemoRecordingController | null>(null);
  const [activeLaneId, setActiveLaneId] = useState<InspectionLaneId>("shell");
  const [isRecordingRrwebDemo, setIsRecordingRrwebDemo] = useState<boolean>(false);
  const [rrwebDemoRecording, setRrwebDemoRecording] = useState<IRrwebDemoRecording | null>(null);
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => {
    return readStoredThemePreference(window.localStorage);
  });
  const activeLane: IInspectionLane = findInspectionLaneById(activeLaneId);

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

  useEffect((): (() => void) => {
    return (): void => {
      const activeRecordingController = activeRecordingControllerRef.current;

      if (activeRecordingController !== null) {
        activeRecordingController.stop();
        activeRecordingControllerRef.current = null;
      }
    };
  }, []);

  useEffect((): void => {
    document.documentElement.dataset.theme = themePreference;
    window.localStorage.setItem(themeStorageKey, themePreference);
  }, [themePreference]);

  return (
    <main className="app-shell" data-testid="App">
      <div className="app-frame">
        <header className="app-header">
          <div className="app-header__copy">
            <p className="app-kicker">Devhost test app</p>
            <p className="app-header__title">Framer audit with restored theme switching</p>
          </div>

          <div className="app-header__actions">
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

            <div className="app-header__metrics" aria-label="Audit metrics">
              {auditMetrics.map((auditMetric: IAuditMetric) => {
                return (
                  <article
                    key={auditMetric.label}
                    className="metric-pill"
                    aria-label={auditMetric.label}
                  >
                    <p className="metric-pill__label">{auditMetric.label}</p>
                    <p className="metric-pill__value">{auditMetric.value}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </header>

        <section className="hero-section">
          <div className="hero-section__copy">
            <p className="app-kicker">Dark Framer baseline, explicit light override</p>
            <h1 className="app-title">Framer-style overlay audit surface</h1>
            <p className="app-body">
              I restored a real System, Light, and Dark switch because that is what you asked for. Dark remains the
              reference mode from the Framer skill, while light mode is now an explicit override for comparison work.
            </p>
          </div>

          <aside className="hero-panel" aria-labelledby="hero-panel-title">
            <p className="panel-kicker">What changed</p>
            <h2 id="hero-panel-title" className="section-title">
              The shell can compare themes again without faking it
            </h2>
            <ul className="bullet-list">
              <li>Dark mode remains the baseline audit surface instead of being silently downgraded.</li>
              <li>System, Light, and Dark now switch actual token sets rather than relabeling one palette.</li>
              <li>The selected mode persists so the app and Storybook can validate the same behavior.</li>
            </ul>
          </aside>
        </section>

        <section className="inspection-section" aria-labelledby="inspection-section-title">
          <div className="inspection-section__intro">
            <p className="panel-kicker">Inspection lanes</p>
            <h2 id="inspection-section-title" className="section-title">
              Switch the lane, then verify the shell still feels coherent
            </h2>
            <p className="app-body">
              The controls stay intentionally plain. If state clarity depends on a hover gimmick or a blur trick, the UI
              is doing presentation instead of product work.
            </p>
          </div>

          <div className="inspection-section__content">
            <div className="lane-button-group" role="group" aria-label="Inspection lanes">
              {inspectionLanes.map((inspectionLane: IInspectionLane) => {
                const isActive: boolean = inspectionLane.id === activeLaneId;

                return (
                  <button
                    key={inspectionLane.id}
                    type="button"
                    className="lane-button"
                    aria-pressed={isActive}
                    onClick={(): void => {
                      setActiveLaneId(inspectionLane.id);
                    }}
                  >
                    {inspectionLane.kicker}
                  </button>
                );
              })}
            </div>

            <article className="lane-detail" aria-labelledby="active-lane-title">
              <p className="panel-kicker">{activeLane.kicker}</p>
              <h3 id="active-lane-title" className="section-title">
                {activeLane.title}
              </h3>
              <p className="app-body">{activeLane.body}</p>
              <ul className="bullet-list">
                {activeLane.checklist.map((checklistItem: string) => {
                  return <li key={checklistItem}>{checklistItem}</li>;
                })}
              </ul>
            </article>
          </div>
        </section>

        <RrwebDemoPanel
          isRecording={isRecordingRrwebDemo}
          onExportRecording={handleExportRrwebRecording}
          onStartRecording={handleStartRrwebRecording}
          onStopRecording={handleStopRrwebRecording}
          recording={rrwebDemoRecording}
        />

        <section className="signal-grid" aria-label="Framer audit cards">
          {auditSections.map((auditSection: IAuditSection) => {
            return (
              <article key={auditSection.title} className="signal-card">
                <p className="panel-kicker">{auditSection.eyebrow}</p>
                <h2 className="section-title">{auditSection.title}</h2>
                <p className="card-body">{auditSection.body}</p>
              </article>
            );
          })}
        </section>

        <section className="diagnostic-stack" aria-labelledby="diagnostic-stack-title">
          <div className="diagnostic-stack__intro">
            <p className="panel-kicker">Long-form diagnostics</p>
            <h2 id="diagnostic-stack-title" className="section-title">
              Scroll through the full page and look for hierarchy drift
            </h2>
            <p className="app-body">
              The content below exists to create enough depth for real overlay evaluation. If fixed chrome feels
              detached or the reading panes become noisy in one theme, the shell still needs work.
            </p>
          </div>

          <div className="diagnostic-stack__grid">
            {diagnosticSections.map((diagnosticSection: IDiagnosticSection, index: number) => {
              return (
                <article key={diagnosticSection.title} className="diagnostic-card">
                  <div className="diagnostic-card__header">
                    <span className="diagnostic-index">{String(index + 1).padStart(2, "0")}</span>
                    <h3 className="section-title">{diagnosticSection.title}</h3>
                  </div>
                  {diagnosticSection.paragraphs.map((paragraph: string) => {
                    return (
                      <p key={paragraph} className="diagnostic-body">
                        {paragraph}
                      </p>
                    );
                  })}
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
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

function findInspectionLaneById(activeLaneId: InspectionLaneId): IInspectionLane {
  const activeLane: IInspectionLane | undefined = inspectionLanes.find(
    (inspectionLane: IInspectionLane): boolean => {
      return inspectionLane.id === activeLaneId;
    },
  );

  if (activeLane === undefined) {
    throw new Error(`Missing inspection lane for id: ${activeLaneId}`);
  }

  return activeLane;
}
