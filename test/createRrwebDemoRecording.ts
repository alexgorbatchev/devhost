import { record } from "@rrweb/all";
import type { eventWithTime } from "@rrweb/types";

type RecordedEvent = eventWithTime;

export interface IRrwebDemoRecording {
  durationMs: number;
  events: RecordedEvent[];
}

export interface IRrwebDemoRecordingController {
  stop: () => IRrwebDemoRecording;
}

export function createRrwebDemoRecording(): IRrwebDemoRecordingController {
  const events: RecordedEvent[] = [];
  const startedAt = performance.now();
  const stopRecording = record({
    emit(event): void {
      events.push(event);
    },
    recordCanvas: true,
  });

  return {
    stop(): IRrwebDemoRecording {
      if (typeof stopRecording === "function") {
        stopRecording();
      }

      return {
        durationMs: Math.max(0, performance.now() - startedAt),
        events: [...events],
      };
    },
  };
}
