import React, { useEffect, type JSX } from "react";

import { FeatureReplayPanel } from "./FeatureReplayPanel";
import type { IRrwebDemoRecording } from "./types";

const startShortcutLabel: string = "Alt+Shift+A";
const primaryButtonClassName: string =
  "inline-flex h-11 items-center justify-center rounded-md border border-transparent bg-primary px-4 text-sm font-medium text-primary-foreground shadow-[var(--shadow-soft)] transition hover:-translate-y-px hover:shadow-[var(--shadow-raised)] disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButtonClassName: string =
  "inline-flex h-11 items-center justify-center rounded-md border border-border-subtle bg-card px-4 text-sm text-foreground shadow-[var(--shadow-soft)] transition hover:border-border-strong hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50";

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
            <button
              type="button"
              className={primaryButtonClassName}
              aria-keyshortcuts={startShortcutLabel}
              onClick={props.onStartRecording}
            >
              Start recording · {startShortcutLabel}
            </button>
          ) : null}

          {shouldShowExportButton ? (
            <button type="button" className={secondaryButtonClassName} onClick={props.onExportRecording}>
              Export JSON
            </button>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
