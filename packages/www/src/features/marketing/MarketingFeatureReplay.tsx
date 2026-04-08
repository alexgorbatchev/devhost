import React, { useEffect, useRef, useState, type JSX } from "react";

import { FeatureReplayPanel, loadRrwebDemoRecording, type IRrwebDemoRecording } from "../rrweb";
import type { IFeatureHighlight } from "./types";

type ReplayLoadStatus = "error" | "loading" | "missing" | "ready";

export interface IMarketingFeatureReplayProps {
  featureHighlight: IFeatureHighlight;
}

export function MarketingFeatureReplay(props: IMarketingFeatureReplayProps): JSX.Element {
  const recordingsByUrlRef = useRef<Map<string, IRrwebDemoRecording | null>>(new Map());
  const [recording, setRecording] = useState<IRrwebDemoRecording | null>(null);
  const [status, setStatus] = useState<ReplayLoadStatus>("loading");
  const replayHeadingId: string = `feature-replay-${props.featureHighlight.id}`;

  useEffect((): (() => void) | void => {
    const cachedRecording: IRrwebDemoRecording | null | undefined = recordingsByUrlRef.current.get(
      props.featureHighlight.demoRecordingUrl,
    );

    if (cachedRecording !== undefined) {
      setRecording(cachedRecording);
      setStatus(cachedRecording === null ? "missing" : "ready");
      return;
    }

    let isCancelled = false;

    setRecording(null);
    setStatus("loading");

    void loadRrwebDemoRecording(props.featureHighlight.demoRecordingUrl)
      .then((nextRecording: IRrwebDemoRecording | null): void => {
        if (isCancelled) {
          return;
        }

        recordingsByUrlRef.current.set(props.featureHighlight.demoRecordingUrl, nextRecording);
        setRecording(nextRecording);
        setStatus(nextRecording === null ? "missing" : "ready");
      })
      .catch((error: unknown): void => {
        if (isCancelled) {
          return;
        }

        console.error(error);
        setRecording(null);
        setStatus("error");
      });

    return (): void => {
      isCancelled = true;
    };
  }, [props.featureHighlight.demoRecordingUrl]);

  return (
    <section className="grid gap-3 border-t border-border-subtle pt-4" aria-labelledby={replayHeadingId}>
      <div className="grid gap-2">
        <h4 id={replayHeadingId} className="text-xl font-medium leading-tight tracking-[-0.04em] text-card-foreground sm:text-2xl">
          {props.featureHighlight.title}
        </h4>
        <p className="max-w-[72ch] text-sm leading-7 text-muted-foreground">
          Use this recording to demonstrate the exact interaction path for {props.featureHighlight.kicker.toLowerCase()}.
        </p>
      </div>

      <p className="text-sm leading-6 text-muted-foreground" role="status">
        {readReplayMessage(status, props.featureHighlight.demoRecordingUrl)}
      </p>

      <FeatureReplayPanel emptyMessage={readReplayMessage(status, props.featureHighlight.demoRecordingUrl)} recording={recording} />
    </section>
  );
}

function readReplayMessage(status: ReplayLoadStatus, recordingUrl: string): string {
  switch (status) {
    case "error": {
      return `Replay failed to load. Check the browser console and validate ${recordingUrl}.`;
    }
    case "missing": {
      return `Replay missing. Add the recording JSON at ${recordingUrl}.`;
    }
    case "ready": {
      return "Replay ready.";
    }
    default: {
      return "Loading the selected replay.";
    }
  }
}
