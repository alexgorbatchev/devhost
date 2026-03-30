import { TIME_API_PATH } from "./constants";
import type { TimeResponse } from "./types";

export async function fetchCurrentTime(): Promise<string> {
  const response: Response = await fetch(TIME_API_PATH, {
    credentials: "same-origin",
  });

  if (!response.ok) {
    throw new Error(`devhost time request failed: ${response.status}`);
  }

  const payload: unknown = await response.json();

  if (!isTimeResponse(payload)) {
    throw new Error("devhost time response is malformed");
  }

  return payload.currentTime;
}

function isTimeResponse(value: unknown): value is TimeResponse {
  return typeof value === "object" && value !== null && typeof Reflect.get(value, "currentTime") === "string";
}
