import { DEMO_VIDEOS_INDEX_PATH } from "./constants";
import type { IDemoVideo } from "./types";

type VideoListFetcher = (input: string, init: RequestInit) => Promise<Response>;

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isDemoVideo(value: unknown): value is IDemoVideo {
  if (typeof value !== "object" || value === null) return false;
  if (!("id" in value && "kind" in value && "title" in value && "src" in value)) return false;
  if (!("bytes" in value)) return false;
  return (
    typeof value.id === "string" &&
    (value.kind === "recording" || value.kind === "guide" || value.kind === "published") &&
    typeof value.title === "string" &&
    typeof value.src === "string" &&
    typeof value.bytes === "number" &&
    isOptionalString("modified" in value ? value.modified : undefined) &&
    isOptionalString("poster" in value ? value.poster : undefined) &&
    isOptionalString("captions" in value ? value.captions : undefined)
  );
}

export async function fetchDemoVideos(fetcher: VideoListFetcher, signal: AbortSignal): Promise<IDemoVideo[]> {
  const response = await fetcher(DEMO_VIDEOS_INDEX_PATH, { signal });

  if (!response.ok) {
    throw new Error(`Video list request failed: ${response.status}`);
  }

  const videos: unknown = await response.json();
  if (!Array.isArray(videos) || !videos.every(isDemoVideo)) {
    throw new Error("Video list response is not a list of videos");
  }

  return videos;
}
