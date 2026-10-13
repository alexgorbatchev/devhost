import { rm, utimes } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readDemoMedia } from "../readDemoMedia";

let repositoryDirectory = new URL("file:///");

function hash(content: string): string {
  return new Bun.CryptoHasher("sha256").update(content).digest("hex");
}

async function writeMedia(file: string, modifiedSeconds: number, content = "media"): Promise<string> {
  const path = Bun.fileURLToPath(new URL(file, repositoryDirectory));
  await Bun.write(path, content);
  await utimes(path, modifiedSeconds, modifiedSeconds);
  return path;
}

// The pin file names, for each published guide video, the release asset that holds it and its hash.
async function writePins(videos: Record<string, string>): Promise<void> {
  const files = Object.fromEntries(
    Object.entries(videos).map(([name, content]) => [
      `${name}.mp4`,
      { asset: `${name}-${hash(content).slice(0, 16)}.mp4`, sha256: hash(content), bytes: content.length },
    ]),
  );
  await Bun.write(
    new URL("packages/docs/demo-media.json", repositoryDirectory),
    JSON.stringify({ repository: "alexgorbatchev/devhost", release: "media", files }),
  );
}

function releaseAddress(name: string, content: string): string {
  return `https://github.com/alexgorbatchev/devhost/releases/download/media/${name}-${hash(content).slice(0, 16)}.mp4`;
}

beforeEach(() => {
  repositoryDirectory = new URL(`../../../../../.tmp/demo-media-${Bun.randomUUIDv7()}/`, import.meta.url);
});

afterEach(async () => {
  await rm(Bun.fileURLToPath(repositoryDirectory), { recursive: true, force: true });
});

describe("readDemoMedia", () => {
  test("lists the promo once, from its latest render, and no other run", async () => {
    await writeMedia(".tmp/demos/recording-first/devhost-demo.mp4", 1_000);
    await writeMedia(".tmp/demos/recording-first/promo-footage.json", 1_000);
    await writeMedia(".tmp/demos/recording-second/devhost-demo.mp4", 2_000);
    await writeMedia(".tmp/demos/recording-second/promo-footage.json", 2_000);
    await writeMedia(".tmp/demos/recording-second/poster.png", 2_000);
    // A guide or single-scene run renders a video too, but it is not the promo.
    await writeMedia(".tmp/demos/recording-single-scene/devhost-demo.mp4", 3_000);

    const media = await readDemoMedia(repositoryDirectory);

    expect(media.videos).toEqual([
      {
        id: "promo",
        kind: "promo",
        title: "Promo",
        state: "local",
        src: "/demo-videos/recordings/recording-second/devhost-demo.mp4",
        poster: "/demo-videos/recordings/recording-second/poster.png",
        modified: "1970-01-01T00:33:20.000Z",
        bytes: 5,
      },
    ]);
  });

  test("lists the promo once, as the docs site's copy, when the docs media include it", async () => {
    await writeMedia(".tmp/demos/recording-first/devhost-demo.mp4", 1_000);
    await writeMedia(".tmp/demos/recording-first/promo-footage.json", 1_000);
    await writePins({ promo: "published promo" });
    await writeMedia("packages/docs/public/demos/promo.mp4", 900, "published promo");
    await writeMedia("packages/docs/public/demos/promo.vtt", 900);
    await writeMedia("packages/docs/public/demos/annotations.mp4", 600, "a new render");

    const media = await readDemoMedia(repositoryDirectory);

    expect(media.videos).toEqual([
      {
        id: "promo",
        kind: "promo",
        title: "Promo",
        state: "published",
        src: "/demo-videos/guides/promo.mp4",
        publishedSrc: releaseAddress("promo", "published promo"),
        captions: "/demo-videos/guides/promo.vtt",
        modified: "1970-01-01T00:15:00.000Z",
        bytes: 15,
      },
      {
        id: "guide-annotations",
        kind: "guide",
        title: "annotations",
        state: "unpublished",
        src: "/demo-videos/guides/annotations.mp4",
        modified: "1970-01-01T00:10:00.000Z",
        bytes: 12,
      },
    ]);
    expect([...media.files.keys()]).not.toContain("/demo-videos/recordings/recording-first/devhost-demo.mp4");
  });

  test("lists each guide once and tells a published video from a render that is not published", async () => {
    await writePins({ annotations: "published annotations", devtools: "published devtools" });
    await writeMedia("packages/docs/public/demos/annotations.mp4", 600, "published annotations");
    await writeMedia("packages/docs/public/demos/annotations.vtt", 600);
    await writeMedia("packages/docs/public/demos/annotations.webp", 600);
    await writeMedia("packages/docs/public/demos/devtools.mp4", 700, "a new render");
    await writeMedia("packages/docs/public/demos/new-guide.mp4", 800, "never published");

    const media = await readDemoMedia(repositoryDirectory);

    expect(media.videos).toEqual([
      {
        id: "guide-annotations",
        kind: "guide",
        title: "annotations",
        state: "published",
        src: "/demo-videos/guides/annotations.mp4",
        publishedSrc: releaseAddress("annotations", "published annotations"),
        poster: "/demo-videos/guides/annotations.webp",
        captions: "/demo-videos/guides/annotations.vtt",
        modified: "1970-01-01T00:10:00.000Z",
        bytes: 21,
      },
      {
        id: "guide-devtools",
        kind: "guide",
        title: "devtools",
        state: "unpublished",
        src: "/demo-videos/guides/devtools.mp4",
        publishedSrc: releaseAddress("devtools", "published devtools"),
        modified: "1970-01-01T00:11:40.000Z",
        bytes: 12,
      },
      {
        id: "guide-new-guide",
        kind: "guide",
        title: "new-guide",
        state: "unpublished",
        src: "/demo-videos/guides/new-guide.mp4",
        modified: "1970-01-01T00:13:20.000Z",
        bytes: 15,
      },
    ]);
  });

  test("plays a guide from the GitHub release when the checkout has not downloaded it", async () => {
    await writePins({ annotations: "published annotations" });
    await writeMedia("packages/docs/public/demos/annotations.webp", 600);

    const media = await readDemoMedia(repositoryDirectory);

    expect(media.videos).toEqual([
      {
        id: "guide-annotations",
        kind: "guide",
        title: "annotations",
        state: "remote",
        src: releaseAddress("annotations", "published annotations"),
        publishedSrc: releaseAddress("annotations", "published annotations"),
        poster: "/demo-videos/guides/annotations.webp",
        bytes: 21,
      },
    ]);
  });

  test("maps only the listed files on disk, so nothing else in a run can be requested", async () => {
    await writePins({ annotations: "published annotations" });
    const video = await writeMedia(".tmp/demos/recording-full/devhost-demo.mp4", 1_000);
    await writeMedia(".tmp/demos/recording-full/promo-footage.json", 1_000);
    const poster = await writeMedia(".tmp/demos/recording-full/poster.png", 1_000);
    await writeMedia(".tmp/demos/recording-full/pi-changes.json", 1_000);
    await writeMedia(".tmp/demos/recording-full/raw/startup.mp4", 1_000);
    await writeMedia(".tmp/demos/recording-older/devhost-demo.mp4", 500);
    await writeMedia(".tmp/demos/recording-older/promo-footage.json", 500);
    const guide = await writeMedia("packages/docs/public/demos/devtools.mp4", 500);

    const media = await readDemoMedia(repositoryDirectory);

    // GitHub serves a guide that is not on disk; an earlier promo render is not listed at all.
    expect([...media.files]).toEqual([
      ["/demo-videos/recordings/recording-full/devhost-demo.mp4", video],
      ["/demo-videos/recordings/recording-full/poster.png", poster],
      ["/demo-videos/guides/devtools.mp4", guide],
    ]);
  });

  test.each([
    ["is not JSON", "<html>"],
    ["names no repository", JSON.stringify({ release: "media", files: {} })],
    [
      "puts a path in an asset name",
      JSON.stringify({
        repository: "alexgorbatchev/devhost",
        release: "media",
        files: { "annotations.mp4": { asset: "../../evil/annotations.mp4", sha256: "2".repeat(64), bytes: 1 } },
      }),
    ],
    [
      "points at another host",
      JSON.stringify({
        repository: "evil.example/x/y",
        release: "media",
        files: { "annotations.mp4": { asset: "annotations-273a29aa49b00e5f.mp4", sha256: "2".repeat(64), bytes: 1 } },
      }),
    ],
  ])("lists no release address when the pin file %s", async (_name, manifest) => {
    await Bun.write(new URL("packages/docs/demo-media.json", repositoryDirectory), manifest);
    await writeMedia("packages/docs/public/demos/annotations.mp4", 600);

    const media = await readDemoMedia(repositoryDirectory);

    expect(media.videos.map((video) => [video.id, video.state, video.publishedSrc])).toEqual([
      ["guide-annotations", "unpublished", undefined],
    ]);
  });

  test("lists nothing in a checkout that has no promo render, guide video, or pin", async () => {
    await writeMedia(".tmp/demos/recording-unrendered/raw/startup.mp4", 1_000);
    await writeMedia(".tmp/demos/promo-preflight-AbC123/devhost-demo.mp4", 1_000);

    const media = await readDemoMedia(repositoryDirectory);

    expect({ videos: media.videos, files: [...media.files] }).toEqual({ videos: [], files: [] });
  });
});
