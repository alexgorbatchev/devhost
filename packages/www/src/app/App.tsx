import { useEffect, useRef, useState, type ChangeEvent, type JSX } from "react";

import {
  MarketingFeatureSection,
  MarketingHeroSection,
  MarketingProofSection,
  MarketingWorkflowSection,
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

type RecordingPhase = "arming" | "idle" | "preview" | "recording";

const isDevelopmentMode: boolean = process.env.NODE_ENV === "development";
const themeStorageKey: string = "devhost-test-theme";
const themeOptions: IThemeOption[] = [
  { label: "System", value: "system" },
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
];

export function App(): JSX.Element {
  const activeRecordingControllerRef = useRef<IRrwebDemoRecordingController | null>(null);
  const [recordingPhase, setRecordingPhase] = useState<RecordingPhase>("idle");
  const [rrwebDemoRecording, setRrwebDemoRecording] = useState<IRrwebDemoRecording | null>(null);
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => {
    return readStoredThemePreference(window.localStorage);
  });
  const isRecordingRrwebDemo: boolean = recordingPhase === "arming" || recordingPhase === "recording";

  function handleStartRrwebRecording(): void {
    if (isRecordingRrwebDemo) {
      return;
    }

    setRrwebDemoRecording(null);
    setRecordingPhase("arming");
  }

  function handleStopRrwebRecording(): void {
    if (recordingPhase === "arming") {
      setRecordingPhase("idle");
      return;
    }

    const activeRecordingController = activeRecordingControllerRef.current;

    if (activeRecordingController === null) {
      return;
    }

    const recording = activeRecordingController.stop();

    activeRecordingControllerRef.current = null;
    setRecordingPhase("preview");
    setRrwebDemoRecording(recording);
  }

  function handleExportRrwebRecording(): void {
    if (rrwebDemoRecording === null) {
      return;
    }

    exportRrwebDemoRecording(rrwebDemoRecording);
  }

  useEffect(() => {
    if (recordingPhase !== "arming") {
      return;
    }

    let firstAnimationFrameId = 0;
    let secondAnimationFrameId = 0;

    firstAnimationFrameId = window.requestAnimationFrame((): void => {
      secondAnimationFrameId = window.requestAnimationFrame((): void => {
        activeRecordingControllerRef.current = createRrwebDemoRecording();
        setRecordingPhase("recording");
      });
    });

    return (): void => {
      window.cancelAnimationFrame(firstAnimationFrameId);
      window.cancelAnimationFrame(secondAnimationFrameId);
    };
  }, [recordingPhase]);

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
        <MarketingHeroSection
          themeControl={
            <label className="grid gap-2" htmlFor="theme-preference">
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
          }
        />
        <div className="rounded-lg border border-border-subtle bg-surface-subtle px-4 py-5 shadow-[var(--shadow-soft)] sm:px-5 sm:py-6">
          <MarketingFeatureSection />
        </div>
        <MarketingWorkflowSection />
        <div className="rounded-lg border border-border-subtle bg-surface-subtle px-4 py-5 shadow-[var(--shadow-soft)] sm:px-5 sm:py-6">
          <MarketingProofSection />
        </div>
      </div>
      {isDevelopmentMode ? (
        <RrwebDemoPanel
          isDevelopmentMode={isDevelopmentMode}
          isRecording={isRecordingRrwebDemo}
          onExportRecording={handleExportRrwebRecording}
          onStartRecording={handleStartRrwebRecording}
          onStopRecording={handleStopRrwebRecording}
          recording={rrwebDemoRecording}
        />
      ) : null}
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
