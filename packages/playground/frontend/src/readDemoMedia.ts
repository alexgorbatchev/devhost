import { basename, dirname } from "node:path";
import { DEMO_VIDEOS_PATH } from "./constants";
import type { IDemoMedia, IDemoVideo } from "./types";

type DemoVideoCard = Pick<IDemoVideo, "id" | "kind" | "title">;

interface IPublishedPin {
  asset: string;
  sha256: string;
  bytes: number;
}

async function scan(directory: URL, pattern: string): Promise<string[]> {
  const files = new Bun.Glob(pattern).scan({ cwd: Bun.fileURLToPath(directory), onlyFiles: true });
  // A checkout that never recorded has no directory to scan.
  return (await Array.fromAsync(files).catch((): string[] => [])).sort();
}

function isPublishedPin(value: unknown): value is IPublishedPin {
  return (
    typeof value === "object" &&
    value !== null &&
    "asset" in value &&
    typeof value.asset === "string" &&
    // The asset becomes the last segment of a GitHub address, so it is a plain file name.
    /^[a-z0-9][\w.-]*$/i.test(value.asset) &&
    "sha256" in value &&
    typeof value.sha256 === "string" &&
    "bytes" in value &&
    typeof value.bytes === "number"
  );
}

// `just docs publish-media` records every guide video it uploads to the GitHub media release in the docs package's
// pin file. Maps each pinned video to its pin and its address in that release.
async function readPublishedVideos(repositoryDirectory: URL): Promise<Map<string, IPublishedPin>> {
  const published = new Map<string, IPublishedPin>();
  const manifest: unknown = await Bun.file(new URL("packages/docs/demo-media.json", repositoryDirectory))
    .json()
    .catch((): undefined => undefined);
  if (typeof manifest !== "object" || manifest === null) return published;
  if (!("repository" in manifest && "release" in manifest && "files" in manifest)) return published;
  const { repository, release, files } = manifest;
  // A pin file that is not in the expected shape pins nothing: its values become addresses a browser requests.
  if (typeof repository !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(repository)) return published;
  if (typeof release !== "string" || !/^[\w.-]+$/.test(release)) return published;
  if (typeof files !== "object" || files === null) return published;
  for (const [name, pin] of Object.entries(files)) {
    if (!/^[a-z0-9][a-z0-9-]*\.mp4$/.test(name) || !isPublishedPin(pin)) return new Map();
    published.set(basename(name, ".mp4"), {
      ...pin,
      asset: `https://github.com/${repository}/releases/download/${release}/${pin.asset}`,
    });
  }
  return published;
}

const promoName = "promo";
const promoCard: DemoVideoCard = { id: "promo", kind: "promo", title: "Promo" };

// Reads the disk on every call, so a new render shows on reload.
export async function readDemoMedia(repositoryDirectory: URL): Promise<IDemoMedia> {
  const media: IDemoMedia = { videos: [], files: new Map() };
  const list = (directory: URL, urlPath: string, file: string): string => {
    media.files.set(`${urlPath}${file}`, Bun.fileURLToPath(new URL(file, directory)));
    return `${urlPath}${file}`;
  };

  // `just demo guides` writes each guide's video, poster and captions into the docs site's public directory, and
  // `just docs media` downloads the published videos there. A promo render writes its copy for the landing page
  // there as well.
  const guidesDirectory = new URL("packages/docs/public/demos/", repositoryDirectory);
  const guidesPath = `${DEMO_VIDEOS_PATH}guides/`;
  const published = await readPublishedVideos(repositoryDirectory);
  const onDisk = (await scan(guidesDirectory, "*.mp4")).map((file) => basename(file, ".mp4"));
  const names = [...new Set([...onDisk, ...published.keys()])].sort();

  // `just demo record` and `just demo promo` render the promo into a run's directory and note its footage there.
  // Runs of one scene or one guide render a video as well, and earlier promo renders remain on disk; neither is
  // the current promo.
  const runsDirectory = new URL(".tmp/demos/", repositoryDirectory);
  const runsPath = `${DEMO_VIDEOS_PATH}recordings/`;
  let promo: IDemoVideo | undefined;
  let promoRun = "";
  // Without a docs copy, the promo is the latest render a run holds.
  const footageFiles = names.includes(promoName) ? [] : await scan(runsDirectory, "recording-*/promo-footage.json");
  for (const footage of footageFiles) {
    const run = dirname(footage);
    const video = Bun.file(new URL(`${run}/devhost-demo.mp4`, runsDirectory));
    if (!(await video.exists())) continue;
    const modified = new Date(video.lastModified).toISOString();
    if (promo?.modified !== undefined && promo.modified >= modified) continue;
    promoRun = run;
    promo = {
      ...promoCard,
      state: "local",
      src: `${runsPath}${run}/devhost-demo.mp4`,
      modified,
      bytes: video.size,
    };
  }
  if (promo !== undefined) {
    list(runsDirectory, runsPath, `${promoRun}/devhost-demo.mp4`);
    if (await Bun.file(new URL(`${promoRun}/poster.png`, runsDirectory)).exists()) {
      promo.poster = list(runsDirectory, runsPath, `${promoRun}/poster.png`);
    }
    media.videos.push(promo);
  }

  // The promo comes first, and its docs copy is the one the site shows.
  for (const name of [...names.filter((name) => name === promoName), ...names.filter((name) => name !== promoName)]) {
    const card: DemoVideoCard = name === promoName ? promoCard : { id: `guide-${name}`, kind: "guide", title: name };
    const pin = published.get(name);
    const file = Bun.file(new URL(`${name}.mp4`, guidesDirectory));
    let guide: IDemoVideo;
    if (onDisk.includes(name)) {
      const sha256 = new Bun.CryptoHasher("sha256").update(await file.bytes()).digest("hex");
      guide = {
        ...card,
        state: pin?.sha256 === sha256 ? "published" : "unpublished",
        src: list(guidesDirectory, guidesPath, `${name}.mp4`),
        modified: new Date(file.lastModified).toISOString(),
        bytes: file.size,
      };
    } else if (pin !== undefined) {
      // A checkout that has not run `just docs media` still shows the guide: GitHub serves it.
      guide = { ...card, state: "remote", src: pin.asset, bytes: pin.bytes };
    } else {
      continue;
    }
    if (pin !== undefined) guide.publishedSrc = pin.asset;
    if (await Bun.file(new URL(`${name}.webp`, guidesDirectory)).exists()) {
      guide.poster = list(guidesDirectory, guidesPath, `${name}.webp`);
    }
    // Captions describe the video on disk; the release's copy is played without them.
    if (guide.state !== "remote" && (await Bun.file(new URL(`${name}.vtt`, guidesDirectory)).exists())) {
      guide.captions = list(guidesDirectory, guidesPath, `${name}.vtt`);
    }
    media.videos.push(guide);
  }
  return media;
}
