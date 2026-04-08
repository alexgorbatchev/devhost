import type { eventWithTime } from "@rrweb/types";

import type { IRrwebDemoRecording } from "./types";

export async function loadRrwebDemoRecording(recordingUrl: string): Promise<IRrwebDemoRecording | null> {
  const response = await fetch(recordingUrl, { cache: "no-store" });

  if (!response.ok) {
    return null;
  }

  const recordingValue: unknown = await response.json();

  if (!isRrwebDemoRecording(recordingValue)) {
    throw new Error(`Invalid rrweb demo recording payload from ${recordingUrl}`);
  }

  return recordingValue;
}

function isRecordedEvent(value: unknown): value is eventWithTime {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.type === "number" && typeof value.timestamp === "number" && "data" in value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRrwebDemoRecording(value: unknown): value is IRrwebDemoRecording {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.durationMs === "number" && Array.isArray(value.events) && value.events.every(isRecordedEvent);
}
