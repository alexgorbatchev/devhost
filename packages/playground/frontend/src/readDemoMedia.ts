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
  recordings.sort((first, second) => second.modified.localeCompare(first.modified));

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

  media.videos.push(...recordings, ...guides);
  return media;
}
