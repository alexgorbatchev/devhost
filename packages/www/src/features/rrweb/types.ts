import type { eventWithTime } from "@rrweb/types";

export type RecordedEvent = eventWithTime;

export interface IRrwebDemoRecording {
  durationMs: number;
  events: RecordedEvent[];
}

export interface IRrwebDemoRecordingController {
  stop: () => IRrwebDemoRecording;
}
