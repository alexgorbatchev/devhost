import { useEffect, useRef, type JSX } from "react";
import RrwebPlayer from "rrweb-player";
import "rrweb-player/dist/style.css";

import type { IRrwebDemoRecording } from "./createRrwebDemoRecording";

const replayHeight: number = 720;
const replayWidth: number = 1280;
const startShortcutLabel: string = "Alt+Shift+A";
const stopShortcutLabel: string = "Alt+Shift+S";

export interface IRrwebDemoPanelProps {
  isRecording: boolean;
  onExportRecording: () => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
  recording: IRrwebDemoRecording | null;
}

export function RrwebDemoPanel(props: IRrwebDemoPanelProps): JSX.Element {
  const playerRootRef = useRef<HTMLDivElement | null>(null);

  useEffect((): (() => void) | void => {
    const playerRootElement = playerRootRef.current;

    if (playerRootElement === null) {
      return;
    }

    playerRootElement.replaceChildren();

    if (props.recording === null) {
      return;
    }

    const player = new RrwebPlayer({
      props: {
        autoPlay: true,
        events: props.recording.events,
        height: replayHeight,
        maxScale: 0,
        showController: false,
        speed: 1,
        UNSAFE_replayCanvas: true,
        width: replayWidth,
      },
      target: playerRootElement,
    });

    return (): void => {
      player.getReplayer().destroy();
      playerRootElement.replaceChildren();
    };
  }, [props.recording]);

  useEffect((): (() => void) => {
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
  }, [props.onStartRecording, props.onStopRecording]);

  return (
    <section className="rrweb-section" aria-labelledby="rrweb-section-title" data-testid="RrwebDemoPanel">
      <div className="rrweb-section__header">
        <div>
          <p className="panel-kicker">rrweb sandbox</p>
          <h2 id="rrweb-section-title" className="section-title">
            Start and stop recording yourself, then autoplay the replay
          </h2>
        </div>

        <p className="app-body rrweb-section__body">
          The previous scripted capture was wrong for your use case. This version gives you manual start and stop so you
          can drive the app yourself and then immediately review an autoplay-only rrweb replay.
        </p>

        <div className="rrweb-shortcut-grid" aria-label="rrweb recording shortcuts">
          <p className="rrweb-demo-pill">Start: {startShortcutLabel}</p>
          <p className="rrweb-demo-pill">Stop: {stopShortcutLabel}</p>
          <p className="rrweb-demo-pill">Export: JSON file</p>
          <p className="rrweb-demo-pill">Replay: autoplay only</p>
        </div>

        <div className="rrweb-section__actions">
          <button
            type="button"
            className="rrweb-action-button"
            onClick={props.onStartRecording}
            disabled={props.isRecording}
          >
            Start recording
          </button>

          <button
            type="button"
            className="rrweb-action-button rrweb-action-button--secondary"
            onClick={props.onStopRecording}
            disabled={!props.isRecording}
          >
            Stop recording
          </button>

          <button
            type="button"
            className="rrweb-action-button rrweb-action-button--secondary"
            onClick={props.onExportRecording}
            disabled={props.recording === null || props.isRecording}
          >
            Export JSON
          </button>

          <p className="rrweb-status-note" role="status">
            {readStatusMessage(props.isRecording, props.recording)}
          </p>
        </div>

        {props.recording === null ? null : (
          <div className="rrweb-demo-metadata" aria-label="rrweb replay metadata">
            <p className="rrweb-demo-pill">{formatEventCount(props.recording.events.length)}</p>
            <p className="rrweb-demo-pill">{formatDuration(props.recording.durationMs)}</p>
            <p className="rrweb-demo-pill">Keyboard controlled</p>
          </div>
        )}
      </div>

      <div className="rrweb-player-shell">
        {props.recording === null ? (
          <div className="rrweb-placeholder">
            <p className="card-body rrweb-placeholder__copy">
              Start a recording, interact with the page however you want, then stop it to mount the replay here.
            </p>
          </div>
        ) : (
          <div ref={playerRootRef} className="rrweb-player-root" data-testid="RrwebDemoPanel--player-root" />
        )}
      </div>
    </section>
  );
}

function formatDuration(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(1)} s capture`;
}

function formatEventCount(eventCount: number): string {
  return `${eventCount} events`;
}

function readStatusMessage(isRecording: boolean, recording: IRrwebDemoRecording | null): string {
  if (isRecording) {
    return `Recording now. Use ${stopShortcutLabel} when you are done.`;
  }

  if (recording === null) {
    return `Ready. Use ${startShortcutLabel} to begin recording.`;
  }

  return `Replay ready. Export the JSON now or use ${startShortcutLabel} to replace it with a new capture.`;
}
