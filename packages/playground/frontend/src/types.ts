export type DemoVideoKind = "recording" | "guide";

export interface IDemoVideo {
  id: string;
  kind: DemoVideoKind;
  title: string;
  // URL paths on the playground host.
  src: string;
  poster?: string;
  // WebVTT, the format a `<track>` element reads.
  captions?: string;
  // ISO 8601 time the video file was last written.
  modified: string;
  bytes: number;
}

export interface IDemoMedia {
  videos: IDemoVideo[];
  // URL path of each listed video, poster and captions file, mapped to the file it is read from.
  files: Map<string, string>;
}
