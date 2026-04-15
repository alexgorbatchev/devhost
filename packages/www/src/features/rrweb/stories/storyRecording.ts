import { useEffect, useState } from "react";

import { loadRrwebDemoRecording } from "../loadRrwebDemoRecording";
import type { IRrwebDemoRecording } from "../types";

const storyRecordingUrl: string = "/recordings/marketing/annotation.json";

export function useStoryRecording(): IRrwebDemoRecording | null {
  const [recording, setRecording] = useState<IRrwebDemoRecording | null>(null);

  useEffect(() => {
    let isCancelled = false;

    void loadRrwebDemoRecording(storyRecordingUrl).then((nextRecording) => {
      if (!isCancelled) {
        setRecording(nextRecording);
      }
    });

    return () => {
      isCancelled = true;
    };
  }, []);

  return recording;
}
