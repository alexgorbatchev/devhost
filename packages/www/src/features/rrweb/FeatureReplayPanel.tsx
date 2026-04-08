import { Replayer } from "@rrweb/all";
import { useEffect, useRef, useState, type ChangeEvent, type JSX } from "react";

import type { IRrwebDemoRecording } from "./types";

const defaultReplayViewportHeight: number = 720;
const defaultReplayViewportWidth: number = 1280;
const playerPaddingPx: number = 32;
const secondaryButtonClassName: string =
  "inline-flex h-10 items-center justify-center rounded-md border border-border-subtle bg-card px-4 text-sm text-foreground shadow-[var(--shadow-soft)] transition hover:border-border-strong hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50";

interface IReplayViewportSize {
  height: number;
  width: number;
}

export interface IFeatureReplayPanelProps {
  emptyMessage: string;
  isFullscreen?: boolean;
  recording: IRrwebDemoRecording | null;
}

type EffectCallbackResult = (() => void) | void;

export function FeatureReplayPanel(props: IFeatureReplayPanelProps): JSX.Element {
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
  const isFullscreen: boolean = props.isFullscreen ?? false;

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
    <div className={isFullscreen ? "grid h-full min-h-0" : "grid gap-3"} data-testid="FeatureReplayPanel">
      <div
        className={
          isFullscreen
            ? "grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] overflow-hidden bg-terminal text-terminal-foreground"
            : "overflow-hidden rounded-lg border border-border-subtle bg-terminal text-terminal-foreground shadow-[var(--shadow-soft)]"
        }
      >
        {props.recording === null ? (
          <div className={isFullscreen ? "grid h-full min-h-0 place-items-center bg-surface-subtle px-6 py-10" : "grid min-h-[420px] place-items-center bg-surface-subtle px-6 py-10"}>
            <p className="max-w-[42ch] text-center text-sm leading-7 text-muted-foreground">{props.emptyMessage}</p>
          </div>
        ) : (
          <>
            <div
              ref={playerStageRef}
              className={
                isFullscreen
                  ? "grid min-h-0 place-items-center overflow-hidden bg-surface-subtle p-4 sm:p-6"
                  : "grid min-h-[420px] place-items-center overflow-hidden bg-surface-subtle p-4 sm:p-6"
              }
            >
              <div ref={playerRootRef} className="rrweb-player-root relative max-w-full" data-testid="FeatureReplayPanel--player-root" />
            </div>
            <div
              className={
                isFullscreen
                  ? "grid gap-3 border-t border-border-subtle bg-card px-4 py-3 sm:px-6 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center"
                  : "grid gap-3 border-t border-border-subtle bg-card px-4 py-3 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center"
              }
              data-testid="FeatureReplayPanel--controls"
            >
              <button
                type="button"
                className={secondaryButtonClassName}
                aria-label={isPlaying ? "Pause replay" : "Play replay"}
                onClick={handlePlaybackToggle}
              >
                {isPlaying ? "Pause" : "Play"}
              </button>
              <input
                className="h-2 w-full cursor-pointer accent-primary"
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
    </div>
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
