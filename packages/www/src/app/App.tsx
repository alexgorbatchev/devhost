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
  loadRrwebDemoRecording,
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

export interface IAppProps {
  initialRecordingUrl?: string | null;
  isDevelopmentMode?: boolean;
}

export function App(props: IAppProps): JSX.Element {
  const activeRecordingControllerRef = useRef<IRrwebDemoRecordingController | null>(null);
  const [isRecordingRrwebDemo, setIsRecordingRrwebDemo] = useState<boolean>(false);
  const [rrwebDemoRecording, setRrwebDemoRecording] = useState<IRrwebDemoRecording | null>(null);
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => {
    return readStoredThemePreference(window.localStorage);
  });
  const initialRecordingUrl: string | null = props.initialRecordingUrl ?? null;
  const isDevelopmentMode: boolean = props.isDevelopmentMode ?? false;
  const shouldShowRrwebPanel: boolean =
    initialRecordingUrl !== null || isDevelopmentMode || rrwebDemoRecording !== null;

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
    <main className="relative min-h-dvh bg-background text-foreground" data-testid="App">
      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 rounded-lg border border-border bg-card px-4 py-4 shadow-sm sm:px-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center gap-2 text-[0.72rem] uppercase tracking-[0.28em] text-muted-foreground">
              <span className="rounded-md border border-border bg-background px-2 py-1 text-foreground">devhost</span>
              <span>Managed Caddy, routed hosts, source-aware devtools</span>
            </div>
            <p className="max-w-[52ch] text-sm leading-6 text-muted-foreground">
              Switch themes, inspect the routed surface, and keep the entire demo inside one restrained operator shell.
            </p>
          </div>

          <label className="grid gap-2 lg:min-w-[180px]" htmlFor="theme-preference">
            <span className="text-[0.72rem] uppercase tracking-[0.28em] text-muted-foreground">Theme</span>
            <select
              id="theme-preference"
              className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
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

        {shouldShowRrwebPanel ? (
          <section aria-label="Live replay demo">
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

        <MarketingFeatureSection
          defaultFeatureId={marketingContent.defaultFeatureId}
          featureHighlights={marketingContent.featureHighlights}
          featureSectionProofCardId={marketingContent.featureSectionProofCardId}
          proofCards={marketingContent.proofCards}
        />
        <MarketingWorkflowSection
          manifestPreviewLines={marketingContent.manifestPreviewLines}
          workflowSteps={marketingContent.workflowSteps}
        />
        <MarketingProofSection
          excludedProofCardId={marketingContent.featureSectionProofCardId}
          proofCards={marketingContent.proofCards}
        />
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
