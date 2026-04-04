import { Replayer } from "@rrweb/all";
import { useEffect, useRef, useState, type ChangeEvent, type JSX } from "react";

import type { IRrwebDemoRecording } from "./createRrwebDemoRecording";

const defaultReplayViewportHeight: number = 720;
const defaultReplayViewportWidth: number = 1280;
const playerPaddingPx: number = 32;
const startShortcutLabel: string = "Alt+Shift+A";
const stopShortcutLabel: string = "Alt+Shift+S";

interface IReplayViewportSize {
  height: number;
  width: number;
}

export interface IRrwebDemoPanelProps {
  isDevelopmentMode: boolean;
  isRecording: boolean;
  onExportRecording: () => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
  recording: IRrwebDemoRecording | null;
}

export function RrwebDemoPanel(props: IRrwebDemoPanelProps): JSX.Element {
  const playerRootRef = useRef<HTMLDivElement | null>(null);
  const playerStageRef = useRef<HTMLDivElement | null>(null);
  const replayerRef = useRef<Replayer | null>(null);
  const [currentTimeMs, setCurrentTimeMs] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playerScale, setPlayerScale] = useState<number>(1);
  const [totalTimeMs, setTotalTimeMs] = useState<number>(0);
  const [viewportSize, setViewportSize] = useState<IReplayViewportSize>({
    height: defaultReplayViewportHeight,
    width: defaultReplayViewportWidth,
  });

  useEffect((): (() => void) | void => {
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
  }, [props.isDevelopmentMode, props.onStartRecording, props.onStopRecording]);

  useEffect((): (() => void) | void => {
    const playerRootElement = playerRootRef.current;

    if (playerRootElement === null) {
      return;
    }

    playerRootElement.replaceChildren();
    replayerRef.current?.destroy();
    replayerRef.current = null;
    setCurrentTimeMs(0);
    setIsPlaying(false);
    setTotalTimeMs(0);
    setViewportSize({
      height: defaultReplayViewportHeight,
      width: defaultReplayViewportWidth,
    });

    if (props.recording === null) {
      return;
    }

    const nextReplayer = new Replayer(props.recording.events, {
      mouseTail: true,
      root: playerRootElement,
      UNSAFE_replayCanvas: true,
    });
    const initialViewportSize = readInitialReplayViewportSize(props.recording);
    const replayMetadata = nextReplayer.getMetaData();

    replayerRef.current = nextReplayer;
    setTotalTimeMs(replayMetadata.totalTime);
    setViewportSize(initialViewportSize);

    function handlePause(): void {
      setCurrentTimeMs(clampPlaybackTime(nextReplayer.getCurrentTime(), replayMetadata.totalTime));
      setIsPlaying(false);
    }

    function handleFinish(): void {
      setCurrentTimeMs(replayMetadata.totalTime);
      setIsPlaying(false);
    }

    function handleResize(payload: unknown): void {
      if (isReplayViewportSize(payload)) {
        setViewportSize(payload);
      }
    }

    function handleStart(): void {
      setIsPlaying(true);
    }

    nextReplayer.on("finish", handleFinish);
    nextReplayer.on("pause", handlePause);
    nextReplayer.on("resize", handleResize);
    nextReplayer.on("start", handleStart);
    nextReplayer.play();

    return (): void => {
      nextReplayer.off("finish", handleFinish);
      nextReplayer.off("pause", handlePause);
      nextReplayer.off("resize", handleResize);
      nextReplayer.off("start", handleStart);
      nextReplayer.destroy();
      playerRootElement.replaceChildren();

      if (replayerRef.current === nextReplayer) {
        replayerRef.current = null;
      }
    };
  }, [props.recording]);

  useEffect((): (() => void) | void => {
    if (!isPlaying) {
      return;
    }

    let animationFrameId = 0;

    const tick = (): void => {
      const activeReplayer = replayerRef.current;

      if (activeReplayer === null) {
        return;
      }

      setCurrentTimeMs(clampPlaybackTime(activeReplayer.getCurrentTime(), totalTimeMs));
      animationFrameId = window.requestAnimationFrame(tick);
    };

    animationFrameId = window.requestAnimationFrame(tick);

    return (): void => {
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [isPlaying, totalTimeMs]);

  useEffect((): (() => void) | void => {
    const playerStageElement = playerStageRef.current;

    if (playerStageElement === null) {
      return;
    }

    const resizeObserver = new ResizeObserver((): void => {
      setPlayerScale(computePlayerScale(playerStageElement, viewportSize));
    });

    resizeObserver.observe(playerStageElement);
    setPlayerScale(computePlayerScale(playerStageElement, viewportSize));

    return (): void => {
      resizeObserver.disconnect();
    };
  }, [viewportSize]);

  useEffect((): void => {
    const playerRootElement = playerRootRef.current;
    const playerWrapperElement = playerRootElement?.querySelector(".replayer-wrapper");

    if (!(playerRootElement instanceof HTMLDivElement) || !(playerWrapperElement instanceof HTMLDivElement)) {
      return;
    }

    const scaledHeight = Math.round(viewportSize.height * playerScale);
    const scaledWidth = Math.round(viewportSize.width * playerScale);

    playerRootElement.style.height = `${scaledHeight}px`;
    playerRootElement.style.width = `${scaledWidth}px`;
    playerWrapperElement.style.transform = `scale(${playerScale})`;
    playerWrapperElement.style.transformOrigin = "top left";
  }, [playerScale, viewportSize]);

  function handlePlaybackToggle(): void {
    const activeReplayer = replayerRef.current;

    if (activeReplayer === null) {
      return;
    }

    if (isPlaying) {
      activeReplayer.pause();
      return;
    }

    const nextTimeMs = currentTimeMs >= totalTimeMs ? 0 : currentTimeMs;

    activeReplayer.play(nextTimeMs);
  }

  function handleTimelineChange(event: ChangeEvent<HTMLInputElement>): void {
    const activeReplayer = replayerRef.current;
    const nextTimeMs = Number.parseFloat(event.currentTarget.value);

    if (Number.isNaN(nextTimeMs)) {
      return;
    }

    setCurrentTimeMs(nextTimeMs);

    if (activeReplayer === null) {
      return;
    }

    activeReplayer.pause(nextTimeMs);
  }

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
          The player loads the default rrweb recording on page load and starts playing immediately. In development mode
          you can replace it by recording a new session, stopping it, and exporting the resulting JSON.
        </p>

        <div className="rrweb-shortcut-grid" aria-label="rrweb recording shortcuts">
          <p className="rrweb-demo-pill">Player: autoplay on load</p>
          <p className="rrweb-demo-pill">Controls: hover to reveal</p>
          {props.isDevelopmentMode ? <p className="rrweb-demo-pill">Start: {startShortcutLabel}</p> : null}
          {props.isDevelopmentMode ? <p className="rrweb-demo-pill">Stop: {stopShortcutLabel}</p> : null}
          {props.isDevelopmentMode ? <p className="rrweb-demo-pill">Export: JSON file</p> : null}
        </div>

        {props.isDevelopmentMode ? (
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
              {readStatusMessage(props.isDevelopmentMode, props.isRecording, props.recording)}
            </p>
          </div>
        ) : null}

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
              The player appears here after the initial recording loads or after you stop a new development capture.
            </p>
          </div>
        ) : (
          <div ref={playerStageRef} className="rrweb-player-stage">
            <div ref={playerRootRef} className="rrweb-player-root" data-testid="RrwebDemoPanel--player-root" />
            <div className="rrweb-player-controls" data-testid="RrwebDemoPanel--controls">
              <button
                type="button"
                className="rrweb-player-toggle"
                aria-label={isPlaying ? "Pause replay" : "Play replay"}
                onClick={handlePlaybackToggle}
              >
                {isPlaying ? "Pause" : "Play"}
              </button>
              <input
                className="rrweb-player-timeline"
                aria-label="Replay timeline"
                max={Math.max(totalTimeMs, 1)}
                min={0}
                onChange={handleTimelineChange}
                step={10}
                type="range"
                value={Math.min(currentTimeMs, Math.max(totalTimeMs, 1))}
              />
              <p className="rrweb-player-time">
                {formatPlaybackTime(currentTimeMs)} / {formatPlaybackTime(totalTimeMs)}
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function clampPlaybackTime(currentTimeMs: number, totalTimeMs: number): number {
  return Math.min(Math.max(currentTimeMs, 0), totalTimeMs);
}

function computePlayerScale(playerStageElement: HTMLElement, viewportSize: IReplayViewportSize): number {
  const availableHeight = Math.max(1, playerStageElement.clientHeight - playerPaddingPx);
  const availableWidth = Math.max(1, playerStageElement.clientWidth - playerPaddingPx);
  const heightScale = availableHeight / viewportSize.height;
  const widthScale = availableWidth / viewportSize.width;

  return Math.min(heightScale, widthScale, 1);
}

function formatDuration(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(1)} s capture`;
}

function formatEventCount(eventCount: number): string {
  return `${eventCount} events`;
}

function formatPlaybackTime(durationMs: number): string {
  const durationInSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(durationInSeconds / 3600);
  const minutes = Math.floor((durationInSeconds % 3600) / 60);
  const seconds = durationInSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isReplayViewportSize(value: unknown): value is IReplayViewportSize {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.height === "number" && typeof value.width === "number";
}

function readInitialReplayViewportSize(recording: IRrwebDemoRecording): IReplayViewportSize {
  const firstEvent = recording.events[0];

  if (!isRecord(firstEvent) || !isRecord(firstEvent.data)) {
    return {
      height: defaultReplayViewportHeight,
      width: defaultReplayViewportWidth,
    };
  }

  const { height, width } = firstEvent.data;

  if (typeof height !== "number" || typeof width !== "number") {
    return {
      height: defaultReplayViewportHeight,
      width: defaultReplayViewportWidth,
    };
  }

  return { height, width };
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
    return isDevelopmentMode ? `Ready. Use ${startShortcutLabel} to begin recording.` : "Loading the default replay.";
  }

  return isDevelopmentMode
    ? `Replay ready. Export the JSON now or use ${startShortcutLabel} to replace it with a new capture.`
    : "Replay ready.";
}
