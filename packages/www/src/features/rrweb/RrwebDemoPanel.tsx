import { Replayer } from "@rrweb/all";
import React, { useEffect, useRef, useState, type ChangeEvent, type JSX } from "react";

import type { IRrwebDemoRecording } from "./types";

const defaultReplayViewportHeight: number = 720;
const defaultReplayViewportWidth: number = 1280;
const playerPaddingPx: number = 32;
const startShortcutLabel: string = "Alt+Shift+A";
const stopShortcutLabel: string = "Alt+Shift+S";
const primaryButtonClassName: string =
  "inline-flex h-10 items-center justify-center rounded-md border border-border bg-primary px-4 text-sm text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButtonClassName: string =
  "inline-flex h-10 items-center justify-center rounded-md border border-border bg-background px-4 text-sm text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";

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

type EffectCallbackResult = (() => void) | void;

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

  useEffect((): EffectCallbackResult => {
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

  useEffect((): EffectCallbackResult => {
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

  useEffect((): EffectCallbackResult => {
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
    <section className="grid gap-4 rounded-lg border border-border bg-card p-4 shadow-sm sm:p-5" aria-label="rrweb replay panel" data-testid="RrwebDemoPanel">
      <div className="grid gap-4 border-b border-border pb-4">
        <div className="flex flex-wrap gap-2" aria-label="rrweb recording shortcuts">
          <p className="rounded-md border border-border bg-muted px-3 py-2 text-[0.72rem] uppercase tracking-[0.2em] text-muted-foreground">
            Player: autoplay on load
          </p>
          <p className="rounded-md border border-border bg-muted px-3 py-2 text-[0.72rem] uppercase tracking-[0.2em] text-muted-foreground">
            Controls: live dock
          </p>
          {props.isDevelopmentMode ? (
            <p className="rounded-md border border-border bg-muted px-3 py-2 text-[0.72rem] uppercase tracking-[0.2em] text-muted-foreground">
              Start: {startShortcutLabel}
            </p>
          ) : null}
          {props.isDevelopmentMode ? (
            <p className="rounded-md border border-border bg-muted px-3 py-2 text-[0.72rem] uppercase tracking-[0.2em] text-muted-foreground">
              Stop: {stopShortcutLabel}
            </p>
          ) : null}
          {props.isDevelopmentMode ? (
            <p className="rounded-md border border-border bg-muted px-3 py-2 text-[0.72rem] uppercase tracking-[0.2em] text-muted-foreground">
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

          {props.recording === null ? null : (
            <div className="flex flex-wrap gap-2" aria-label="rrweb replay metadata">
              <p className="rounded-md border border-border bg-muted px-3 py-2 text-[0.72rem] uppercase tracking-[0.2em] text-muted-foreground">
                {formatEventCount(props.recording.events.length)}
              </p>
              <p className="rounded-md border border-border bg-muted px-3 py-2 text-[0.72rem] uppercase tracking-[0.2em] text-muted-foreground">
                {formatDuration(props.recording.durationMs)}
              </p>
              <p className="rounded-md border border-border bg-muted px-3 py-2 text-[0.72rem] uppercase tracking-[0.2em] text-muted-foreground">
                Keyboard controlled
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-background">
        {props.recording === null ? (
          <div className="grid min-h-[420px] place-items-center bg-muted/40 px-6 py-10">
            <p className="max-w-[42ch] text-center text-sm leading-7 text-muted-foreground">
              The player appears here after the initial recording loads or after you stop a new development capture.
            </p>
          </div>
        ) : (
          <>
            <div ref={playerStageRef} className="grid min-h-[420px] place-items-center overflow-hidden bg-muted/40 p-4 sm:p-6">
              <div ref={playerRootRef} className="rrweb-player-root relative max-w-full" data-testid="RrwebDemoPanel--player-root" />
            </div>
            <div className="grid gap-3 border-t border-border bg-card px-4 py-3 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center" data-testid="RrwebDemoPanel--controls">
              <button
                type="button"
                className={secondaryButtonClassName}
                aria-label={isPlaying ? "Pause replay" : "Play replay"}
                onClick={handlePlaybackToggle}
              >
                {isPlaying ? "Pause" : "Play"}
              </button>
              <input
                className="h-2 w-full cursor-pointer accent-foreground"
                aria-label="Replay timeline"
                max={Math.max(totalTimeMs, 1)}
                min={0}
                onChange={handleTimelineChange}
                step={10}
                type="range"
                value={Math.min(currentTimeMs, Math.max(totalTimeMs, 1))}
              />
              <p className="text-sm tabular-nums text-muted-foreground lg:text-right">
                {formatPlaybackTime(currentTimeMs)} / {formatPlaybackTime(totalTimeMs)}
              </p>
            </div>
          </>
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
