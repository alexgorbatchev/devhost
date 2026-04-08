import React, { useEffect, useRef, useState, type ChangeEvent, type JSX } from "react";

import {
  MarketingFeatureSection,
  MarketingHeroSection,
  MarketingProofSection,
  MarketingWorkflowSection,
  marketingContent,
} from "../features/marketing";
import {
  createRrwebDemoRecording,
  exportRrwebDemoRecording,
  RrwebDemoPanel,
  type IRrwebDemoRecording,
  type IRrwebDemoRecordingController,
} from "../features/rrweb";

type ThemePreference = "system" | "light" | "dark";

interface IThemeOption {
  label: string;
  value: ThemePreference;
}

const themeStorageKey: string = "devhost-test-theme";
const themeOptions: IThemeOption[] = [
  { label: "System", value: "system" },
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
];

export function App(): JSX.Element {
  const activeRecordingControllerRef = useRef<IRrwebDemoRecordingController | null>(null);
  const [isRecordingRrwebDemo, setIsRecordingRrwebDemo] = useState<boolean>(false);
  const [rrwebDemoRecording, setRrwebDemoRecording] = useState<IRrwebDemoRecording | null>(null);
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => {
    return readStoredThemePreference(window.localStorage);
  });

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

  useEffect((): void => {
    document.documentElement.dataset.theme = themePreference;
    window.localStorage.setItem(themeStorageKey, themePreference);
  }, [themePreference]);

  return (
    <main className="app-shell relative min-h-dvh bg-background text-foreground" data-testid="App">
      <div className="app-frame mx-auto flex w-full max-w-[1180px] flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 rounded-lg border border-border-subtle bg-card px-4 py-4 shadow-[var(--shadow-soft)] sm:px-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center gap-2 text-[0.72rem] uppercase tracking-[0.28em] text-muted-foreground">
              <span className="rounded-md border border-border bg-primary px-2.5 py-1 text-primary-foreground shadow-[var(--shadow-soft)]">
                devhost
              </span>
              <span>Managed Caddy, routed hosts, source-aware devtools</span>
            </div>
            <p className="max-w-[58ch] text-sm leading-6 text-muted-foreground">
              Switch themes, inspect the routed surface, and keep the entire demo inside one restrained operator shell.
            </p>
          </div>

          <label className="grid gap-2 lg:min-w-[180px]" htmlFor="theme-preference">
            <span className="text-[0.72rem] uppercase tracking-[0.28em] text-muted-foreground">Theme</span>
            <select
              id="theme-preference"
              className="h-10 rounded-md border border-border-strong bg-card px-3 text-sm shadow-[var(--shadow-soft)] outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
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

        <MarketingHeroSection launchCommands={marketingContent.launchCommands} />
        <div className="rounded-lg border border-border-subtle bg-surface-subtle px-4 py-5 shadow-[var(--shadow-soft)] sm:px-5 sm:py-6">
          <MarketingFeatureSection
            defaultFeatureId={marketingContent.defaultFeatureId}
            featureHighlights={marketingContent.featureHighlights}
            featureSectionProofCardId={marketingContent.featureSectionProofCardId}
            proofCards={marketingContent.proofCards}
          />
        </div>
        <MarketingWorkflowSection
          manifestPreviewLines={marketingContent.manifestPreviewLines}
          workflowSteps={marketingContent.workflowSteps}
        />
        <div className="rounded-lg border border-border-subtle bg-surface-subtle px-4 py-5 shadow-[var(--shadow-soft)] sm:px-5 sm:py-6">
          <MarketingProofSection
            excludedProofCardId={marketingContent.featureSectionProofCardId}
            proofCards={marketingContent.proofCards}
          />
        </div>
        <div className="rounded-lg border border-border-subtle bg-surface-subtle px-4 py-4 shadow-[var(--shadow-soft)] sm:px-5 sm:py-5">
          <section className="grid gap-4" aria-labelledby="recording-authoring-title">
            <div className="grid gap-3">
              <p className="text-[0.72rem] uppercase tracking-[0.28em] text-muted-foreground">Recording authoring</p>
              <h2 id="recording-authoring-title" className="text-2xl font-medium leading-tight tracking-[-0.05em] text-foreground sm:text-3xl">
                Capture replacement marketing recordings without rewiring the page.
              </h2>
              <p className="max-w-[72ch] text-sm leading-7 text-muted-foreground">
                Start and stop recording from anywhere on the page with Alt+Shift+A and Alt+Shift+S, then export the
                JSON after each take and replace the matching file in public/recordings/marketing.
              </p>
            </div>

            <RrwebDemoPanel
              isDevelopmentMode
              isRecording={isRecordingRrwebDemo}
              onExportRecording={handleExportRrwebRecording}
              onStartRecording={handleStartRrwebRecording}
              onStopRecording={handleStopRrwebRecording}
              recording={rrwebDemoRecording}
            />
          </section>
        </div>
      </div>
    </main>
  );
}

function parseThemePreference(value: string | null): ThemePreference {
  if (value === "system" || value === "light" || value === "dark") {
    return value;
  }

  return "system";
}

function readStoredThemePreference(storage: Pick<Storage, "getItem">): ThemePreference {
  return parseThemePreference(storage.getItem(themeStorageKey));
}
