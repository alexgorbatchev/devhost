export type DemoVideoKind = "promo" | "guide";

// `local`: a render that is never published from here, as the promo is today.
// `published`: the file on disk is the one the GitHub media release holds.
// `unpublished`: a render on disk that the release does not hold yet.
// `remote`: not on disk, so the page plays the release's copy.
export type DemoVideoState = "local" | "published" | "unpublished" | "remote";

export interface IDemoVideo {
  id: string;
  kind: DemoVideoKind;
  title: string;
  state: DemoVideoState;
  // A URL path on the playground host, or the release address when the video is not on disk.
  src: string;
  // Address of the published copy in the GitHub media release, when the video is pinned.
  publishedSrc?: string;
  poster?: string;
  // WebVTT, the format a `<track>` element reads.
  captions?: string;
  // ISO 8601 time the video file was last written; a video that is not on disk has none.
  modified?: string;
  bytes: number;
}

export interface IDemoMedia {
  videos: IDemoVideo[];
  // URL path of each listed video, poster and captions file on disk, mapped to the file it is read from.
  files: Map<string, string>;
}
