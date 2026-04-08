import React, { useEffect, type JSX } from "react";

import { FeatureReplayPanel } from "./FeatureReplayPanel";
import type { IRrwebDemoRecording } from "./types";

const startShortcutLabel: string = "Alt+Shift+A";
const stopShortcutLabel: string = "Alt+Shift+S";
const primaryButtonClassName: string =
  "inline-flex h-10 items-center justify-center rounded-md border border-transparent bg-primary px-4 text-sm font-medium text-primary-foreground shadow-[var(--shadow-soft)] transition hover:-translate-y-px hover:shadow-[var(--shadow-raised)] disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButtonClassName: string =
  "inline-flex h-10 items-center justify-center rounded-md border border-border-subtle bg-card px-4 text-sm text-foreground shadow-[var(--shadow-soft)] transition hover:border-border-strong hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50";

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
      if (!event.altKey || !event.shiftKey || event.repeat) {
        return;
      }

      if (event.code === "KeyA") {
        event.preventDefault();
        props.onStartRecording();
      }

      if (event.code === "KeyS") {
        event.preventDefault();
        props.onStopRecording();
      }
    }

    window.addEventListener("keydown", handleWindowKeyDown);

    return (): void => {
      window.removeEventListener("keydown", handleWindowKeyDown);
    };
  }, [props]);

  return (
    <section className="grid gap-4 rounded-lg border border-border-subtle bg-card p-4 shadow-[var(--shadow-soft)] sm:p-5" aria-label="rrweb replay panel" data-testid="RrwebDemoPanel">
      <div className="grid gap-4 border-b border-border-subtle pb-4">
        <div className="flex flex-wrap gap-2" aria-label="rrweb recording shortcuts">
          <p className="rounded-md border border-border-subtle bg-surface-subtle px-3 py-2 text-[0.72rem] uppercase tracking-[0.2em] text-muted-foreground">
            Player: autoplay on load
          </p>
          <p className="rounded-md border border-border-subtle bg-surface-subtle px-3 py-2 text-[0.72rem] uppercase tracking-[0.2em] text-muted-foreground">
            Controls: live dock
          </p>
          {props.isDevelopmentMode ? (
            <p className="rounded-md border border-border-subtle bg-surface-subtle px-3 py-2 text-[0.72rem] uppercase tracking-[0.2em] text-muted-foreground">
              Start: {startShortcutLabel}
            </p>
          ) : null}
          {props.isDevelopmentMode ? (
            <p className="rounded-md border border-border-subtle bg-surface-subtle px-3 py-2 text-[0.72rem] uppercase tracking-[0.2em] text-muted-foreground">
              Stop: {stopShortcutLabel}
            </p>
          ) : null}
          {props.isDevelopmentMode ? (
            <p className="rounded-md border border-border-subtle bg-surface-subtle px-3 py-2 text-[0.72rem] uppercase tracking-[0.2em] text-muted-foreground">
              Export: JSON file
            </p>
          ) : null}
        </div>

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="grid gap-2">
            <p className="text-[0.72rem] uppercase tracking-[0.28em] text-muted-foreground">Replay surface</p>
            <p className="max-w-[72ch] text-sm leading-7 text-muted-foreground">
              Record the routed host, then inspect it like an operational replay instead of a marketing screenshot.
            </p>
          </div>

          {props.isDevelopmentMode ? (
            <div className="flex flex-wrap gap-2 lg:justify-end">
              <button type="button" className={primaryButtonClassName} onClick={props.onStartRecording} disabled={props.isRecording}>
                Start recording
              </button>

              <button
                type="button"
                className={secondaryButtonClassName}
                onClick={props.onStopRecording}
                disabled={!props.isRecording}
              >
                Stop recording
              </button>

              <button
                type="button"
                className={secondaryButtonClassName}
                onClick={props.onExportRecording}
                disabled={props.recording === null || props.isRecording}
              >
                Export JSON
              </button>
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <p className="text-sm leading-6 text-muted-foreground" role="status">
            {readStatusMessage(props.isDevelopmentMode, props.isRecording, props.recording)}
          </p>
        </div>
      </div>

      <FeatureReplayPanel
        emptyMessage="The player appears here after the initial recording loads or after you stop a new development capture."
        recording={props.recording}
      />
    </section>
  );
}

function readStatusMessage(
  isDevelopmentMode: boolean,
  isRecording: boolean,
  recording: IRrwebDemoRecording | null,
): string {
  if (isRecording) {
    return `Recording now. Use ${stopShortcutLabel} when you are done.`;
  }

  if (recording === null) {
    return isDevelopmentMode ? `Ready. Use ${startShortcutLabel} to begin recording.` : "Loading the replay.";
  }

  return isDevelopmentMode
    ? `Replay ready. Export the JSON now or use ${startShortcutLabel} to replace it with a new capture.`
    : "Replay ready.";
}
