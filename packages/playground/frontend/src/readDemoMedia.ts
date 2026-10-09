import { basename, dirname } from "node:path";
import { DEMO_VIDEOS_PATH } from "./constants";
import type { DemoVideoKind, IDemoMedia, IDemoVideo } from "./types";

interface IDemoVideoFiles {
  id: string;
  kind: DemoVideoKind;
  title: string;
  // Relative to the directory the video was found in.
  video: string;
  poster: string;
  captions?: string;
}

async function scan(directory: URL, pattern: string): Promise<string[]> {
  const files = new Bun.Glob(pattern).scan({ cwd: Bun.fileURLToPath(directory), onlyFiles: true });
  // A checkout that never recorded has no directory to scan.
  return (await Array.fromAsync(files).catch((): string[] => [])).sort();
}

async function listVideo(media: IDemoMedia, directory: URL, urlPath: string, files: IDemoVideoFiles): Promise<IDemoVideo> {
  const list = (file: string): string => {
    media.files.set(`${urlPath}${file}`, Bun.fileURLToPath(new URL(file, directory)));
    return `${urlPath}${file}`;
  };
  const source = Bun.file(new URL(files.video, directory));
  const video: IDemoVideo = {
    id: files.id,
    kind: files.kind,
    title: files.title,
    src: list(files.video),
    modified: new Date(source.lastModified).toISOString(),
    bytes: source.size,
  };
  if (await Bun.file(new URL(files.poster, directory)).exists()) video.poster = list(files.poster);
  if (files.captions !== undefined && (await Bun.file(new URL(files.captions, directory)).exists())) {
    video.captions = list(files.captions);
  }
  return video;
}

interface IPublishedPin {
  asset: string;
  bytes: number;
}

function isPublishedPin(value: unknown): value is IPublishedPin {
  return (
    typeof value === "object" &&
    value !== null &&
    "asset" in value &&
    typeof value.asset === "string" &&
    // The asset becomes the last segment of a GitHub address, so it is a plain file name.
    /^[a-z0-9][\w.-]*$/i.test(value.asset) &&
    "bytes" in value &&
    typeof value.bytes === "number"
  );
}

// `just docs publish-media` records every video it uploads to the GitHub media release in the docs package's pin file.
async function listPublishedVideos(repositoryDirectory: URL): Promise<IDemoVideo[]> {
  const manifest: unknown = await Bun.file(new URL("packages/docs/demo-media.json", repositoryDirectory))
    .json()
    .catch((): undefined => undefined);
  if (typeof manifest !== "object" || manifest === null) return [];
  if (!("repository" in manifest && "release" in manifest && "files" in manifest)) return [];
  const { repository, release, files } = manifest;
  // A pin file that is not in the expected shape lists nothing: its values become addresses a browser requests.
  if (typeof repository !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(repository)) return [];
  if (typeof release !== "string" || !/^[\w.-]+$/.test(release)) return [];
  if (typeof files !== "object" || files === null) return [];
  const videos: IDemoVideo[] = [];
  for (const [name, pin] of Object.entries(files).sort(([first], [second]) => first.localeCompare(second))) {
    if (!/^[a-z0-9][a-z0-9-]*\.mp4$/.test(name) || !isPublishedPin(pin)) return [];
    const title = basename(name, ".mp4");
    videos.push({
      id: `published-${title}`,
      kind: "published",
      title,
      src: `https://github.com/${repository}/releases/download/${release}/${pin.asset}`,
      bytes: pin.bytes,
    });
  }
  return videos;
}

// Reads the disk on every call, so a new render shows on reload.
export async function readDemoMedia(repositoryDirectory: URL): Promise<IDemoMedia> {
  const media: IDemoMedia = { videos: [], files: new Map() };

  // `just demo record` and `just demo promo` render each run's video into its own directory.
  const runsDirectory = new URL(".tmp/demos/", repositoryDirectory);
  const recordings: IDemoVideo[] = [];
  for (const video of await scan(runsDirectory, "recording-*/devhost-demo.mp4")) {
    const name = dirname(video);
    recordings.push(
      await listVideo(media, runsDirectory, `${DEMO_VIDEOS_PATH}recordings/`, {
        id: name,
        kind: "recording",
        title: name,
        video,
        poster: `${name}/poster.png`,
      }),
    );
  }
  // The render to review is the latest one.
  recordings.sort((first, second) => (second.modified ?? "").localeCompare(first.modified ?? ""));

  // `just demo guides` publishes each guide's video, poster and captions to the docs site.
  const guidesDirectory = new URL("packages/docs/public/demos/", repositoryDirectory);
  const guides: IDemoVideo[] = [];
  for (const video of await scan(guidesDirectory, "*.mp4")) {
    const name = basename(video, ".mp4");
    guides.push(
      await listVideo(media, guidesDirectory, `${DEMO_VIDEOS_PATH}guides/`, {
        id: `guide-${name}`,
        kind: "guide",
        title: name,
        video,
        poster: `${name}.webp`,
        captions: `${name}.vtt`,
      }),
    );
  }

  media.videos.push(...recordings, ...guides, ...(await listPublishedVideos(repositoryDirectory)));
  return media;
}
