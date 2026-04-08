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
  useEffect((): EffectCallbackResult => {
    if (!props.isDevelopmentMode) {
      return;
    }

    function handleWindowKeyDown(event: KeyboardEvent): void {
      if (!event.altKey || !event.shiftKey || event.repeat || event.code !== "KeyA") {
        return;
      }

      event.preventDefault();

      if (props.isRecording) {
        props.onStopRecording();
        return;
      }

      props.onStartRecording();
    }

    window.addEventListener("keydown", handleWindowKeyDown);

    return (): void => {
      window.removeEventListener("keydown", handleWindowKeyDown);
    };
  }, [props.isDevelopmentMode, props.isRecording, props.onStartRecording, props.onStopRecording]);

  if (!props.isDevelopmentMode) {
    return <></>;
  }

  const shouldShowPreview: boolean = props.recording !== null && !props.isRecording;
  const shouldShowStartButton: boolean = props.recording === null && !props.isRecording;
  const shouldShowExportButton: boolean = props.recording !== null && !props.isRecording;

  return (
    <>
      {shouldShowPreview ? (
        <div className="fixed inset-0 z-40 bg-background" data-testid="RrwebDemoPanel--preview">
          <FeatureReplayPanel emptyMessage="Preview unavailable." isFullscreen recording={props.recording} />
        </div>
      ) : null}

      {shouldShowStartButton || shouldShowExportButton ? (
        <section
          className="fixed bottom-4 left-4 z-50 flex flex-wrap items-center gap-2"
          aria-label="rrweb recording controls"
          data-testid="RrwebDemoPanel"
        >
          {shouldShowStartButton ? (
            <Button aria-keyshortcuts={startShortcutLabel} size="large" variant="primary" onClick={props.onStartRecording}>
              Start recording · {startShortcutLabel}
            </Button>
          ) : null}

          {shouldShowExportButton ? (
            <Button size="large" onClick={props.onExportRecording}>
              Export JSON
            </Button>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
