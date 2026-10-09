import { rm, utimes } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readDemoMedia } from "../readDemoMedia";

let repositoryDirectory = new URL("file:///");

async function writeMedia(file: string, modifiedSeconds: number): Promise<string> {
  const path = Bun.fileURLToPath(new URL(file, repositoryDirectory));
  await Bun.write(path, "media");
  await utimes(path, modifiedSeconds, modifiedSeconds);
  return path;
}

beforeEach(() => {
  repositoryDirectory = new URL(`../../../../../.tmp/demo-media-${Bun.randomUUIDv7()}/`, import.meta.url);
});

afterEach(async () => {
  await rm(Bun.fileURLToPath(repositoryDirectory), { recursive: true, force: true });
});

describe("readDemoMedia", () => {
  test("lists each recording's rendered video, latest render first, then the published guide demos by name", async () => {
    await writeMedia(".tmp/demos/recording-first/devhost-demo.mp4", 1_000);
    await writeMedia(".tmp/demos/recording-second/devhost-demo.mp4", 2_000);
    await writeMedia(".tmp/demos/recording-second/poster.png", 2_000);
    await writeMedia("packages/docs/public/demos/devtools.mp4", 500);
    await writeMedia("packages/docs/public/demos/annotations.mp4", 600);
    await writeMedia("packages/docs/public/demos/annotations.vtt", 600);
    await writeMedia("packages/docs/public/demos/annotations.webp", 600);

    const media = await readDemoMedia(repositoryDirectory);

    expect(media.videos).toEqual([
      {
        id: "recording-second",
        kind: "recording",
        title: "recording-second",
        src: "/demo-videos/recordings/recording-second/devhost-demo.mp4",
        poster: "/demo-videos/recordings/recording-second/poster.png",
        modified: "1970-01-01T00:33:20.000Z",
        bytes: 5,
      },
      {
        id: "recording-first",
        kind: "recording",
        title: "recording-first",
        src: "/demo-videos/recordings/recording-first/devhost-demo.mp4",
        modified: "1970-01-01T00:16:40.000Z",
        bytes: 5,
      },
      {
        id: "guide-annotations",
        kind: "guide",
        title: "annotations",
        src: "/demo-videos/guides/annotations.mp4",
        poster: "/demo-videos/guides/annotations.webp",
        captions: "/demo-videos/guides/annotations.vtt",
        modified: "1970-01-01T00:10:00.000Z",
        bytes: 5,
      },
      {
        id: "guide-devtools",
        kind: "guide",
        title: "devtools",
        src: "/demo-videos/guides/devtools.mp4",
        modified: "1970-01-01T00:08:20.000Z",
        bytes: 5,
      },
    ]);
  });

  test("maps only the listed media to files, so nothing else in a recording can be requested", async () => {
    const video = await writeMedia(".tmp/demos/recording-full/devhost-demo.mp4", 1_000);
    const poster = await writeMedia(".tmp/demos/recording-full/poster.png", 1_000);
    await writeMedia(".tmp/demos/recording-full/pi-changes.json", 1_000);
    await writeMedia(".tmp/demos/recording-full/raw/startup.mp4", 1_000);
    const guide = await writeMedia("packages/docs/public/demos/devtools.mp4", 500);

    const media = await readDemoMedia(repositoryDirectory);

    expect([...media.files]).toEqual([
      ["/demo-videos/recordings/recording-full/devhost-demo.mp4", video],
      ["/demo-videos/recordings/recording-full/poster.png", poster],
      ["/demo-videos/guides/devtools.mp4", guide],
    ]);
  });

  test("skips a run that captured footage but rendered no video", async () => {
    await writeMedia(".tmp/demos/recording-unrendered/raw/startup.mp4", 1_000);
    await writeMedia(".tmp/demos/promo-preflight-AbC123/devhost-demo.mp4", 1_000);

    expect((await readDemoMedia(repositoryDirectory)).videos).toEqual([]);
  });

  test("lists nothing in a checkout that has neither recordings nor guide demos", async () => {
    const media = await readDemoMedia(repositoryDirectory);

    expect({ videos: media.videos, files: [...media.files] }).toEqual({ videos: [], files: [] });
  });
});
