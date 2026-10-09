export interface IDemoMediaPin {
  // Name of the release asset that holds the content, so a reader needs no naming rule to build its URL.
  asset: string;
  // Lowercase hexadecimal SHA-256 of the file's content.
  sha256: string;
  bytes: number;
}

export interface IDemoMediaManifest {
  // `owner/name` of the GitHub repository whose release holds the files.
  repository: string;
  // Tag of that release.
  release: string;
  // File name in `public/demos`, mapped to the content the published site serves under it.
  files: Record<string, IDemoMediaPin>;
}

// `different`: the file on disk is not the pinned content, as after a new render that is not published yet.
// `unpinned`: a video on disk that the manifest does not name.
export type DemoMediaState = "current" | "missing" | "different" | "unpinned";

export interface IDemoMediaFileState {
  name: string;
  state: DemoMediaState;
}

export type DemoMediaFetchOutcome = "present" | "downloaded" | "different";

export interface IDemoMediaFetchResult {
  name: string;
  outcome: DemoMediaFetchOutcome;
}

export type DemoMediaFetcher = (url: string) => Promise<Response>;

export type RunCommand = (command: string[]) => Promise<string>;

export type DemoMediaCommand = () => Promise<void>;

export interface IFetchDemoMediaOptions {
  manifest: IDemoMediaManifest;
  // Directory the docs site serves the files from.
  directoryPath: string;
  fetcher: DemoMediaFetcher;
}

export interface IPublishDemoMediaOptions {
  manifestPath: string;
  directoryPath: string;
  // Holds each upload under its release asset name while `gh` reads it.
  stagingPath: string;
  run: RunCommand;
}
