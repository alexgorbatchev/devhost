import { useEffect, type JSX } from "react";

import { Button } from "../../components/ui";
import { FeatureReplayPanel } from "./FeatureReplayPanel";
import type { IRrwebDemoRecording } from "./types";

const startShortcutLabel: string = "Alt+Shift+A";

export interface IRrwebDemoPanelProps {
  isDevelopmentMode: boolean;
  isRecording: boolean;
  onExportRecording: () => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
  recording: IRrwebDemoRecording | null;
}

type EffectCallbackResult = (() => void) | void;

export function RrwebDemoPanel(props: IRrwebDemoPanelProps): JSX.Element {
  const { isDevelopmentMode, isRecording, onExportRecording, onStartRecording, onStopRecording, recording } = props;

  useEffect((): EffectCallbackResult => {
    if (!isDevelopmentMode) {
      return;
    }

    function handleWindowKeyDown(event: KeyboardEvent): void {
      if (!event.altKey || !event.shiftKey || event.repeat || event.code !== "KeyA") {
        return;
      }

      event.preventDefault();

      if (isRecording) {
        onStopRecording();
        return;
      }

      onStartRecording();
    }

    window.addEventListener("keydown", handleWindowKeyDown);

    return (): void => {
      window.removeEventListener("keydown", handleWindowKeyDown);
    };
  }, [isDevelopmentMode, isRecording, onStartRecording, onStopRecording]);

  const shouldShowPreview: boolean = recording !== null && !isRecording;
  const shouldShowStartButton: boolean = recording === null && !isRecording;
  const shouldShowExportButton: boolean = recording !== null && !isRecording;

  return (
    <div className="contents" data-testid="RrwebDemoPanel">
      {isDevelopmentMode && shouldShowPreview ? (
        <div className="fixed inset-0 z-40 bg-background" data-testid="RrwebDemoPanel--preview">
          <FeatureReplayPanel emptyMessage="Preview unavailable." isFullscreen recording={recording} />
        </div>
      ) : null}

      {isDevelopmentMode && (shouldShowStartButton || shouldShowExportButton) ? (
        <section
          className="fixed bottom-4 left-4 z-50 flex flex-wrap items-center gap-2"
          aria-label="rrweb recording controls"
          data-testid="RrwebDemoPanel--controls"
        >
          {shouldShowStartButton ? (
            <Button aria-keyshortcuts={startShortcutLabel} size="large" variant="primary" onClick={onStartRecording}>
              Start recording · {startShortcutLabel}
            </Button>
          ) : null}

          {shouldShowExportButton ? (
            <Button size="large" onClick={onExportRecording}>
              Export JSON
            </Button>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
