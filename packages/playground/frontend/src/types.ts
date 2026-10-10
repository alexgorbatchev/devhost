// `published`: a video in the GitHub media release, which GitHub serves; the others are files in this checkout.
export type DemoVideoKind = "recording" | "guide" | "published";

export interface IDemoVideo {
  id: string;
  kind: DemoVideoKind;
  title: string;
  // A URL path on the playground host, or the release address of a published video.
  src: string;
  poster?: string;
  // WebVTT, the format a `<track>` element reads.
  captions?: string;
  // ISO 8601 time the video file was last written; a published video has no file here.
  modified?: string;
  bytes: number;
}

export interface IDemoMedia {
  videos: IDemoVideo[];
  // URL path of each listed video, poster and captions file, mapped to the file it is read from.
  files: Map<string, string>;
}
