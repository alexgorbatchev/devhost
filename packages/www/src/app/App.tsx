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
    <main className="app-shell min-h-dvh bg-background text-foreground" data-testid="App">
      <div className="app-frame">
        <header className="app-topbar">
          <div className="brand-lockup">
            <p className="brand-lockup__eyebrow">devhost</p>
            <p className="brand-lockup__caption text-muted-foreground">
              Managed Caddy, routed hosts, source-aware devtools
            </p>
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

        <MarketingHeroSection launchCommands={marketingContent.launchCommands} />

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
