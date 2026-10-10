import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createVideoRoutes } from "../createVideoRoutes";

let repositoryDirectory = new URL("file:///");

function request(path: string, headers?: Record<string, string>): Promise<Response> {
  const handler = createVideoRoutes(repositoryDirectory)["/demo-videos/*"];
  assert(handler);
  return handler(new Request(new URL(path, "http://playground.localhost"), { headers }));
}

beforeEach(async () => {
  repositoryDirectory = new URL(`../../../../../.tmp/video-routes-${Bun.randomUUIDv7()}/`, import.meta.url);
  await Bun.write(new URL(".tmp/demos/recording-full/devhost-demo.mp4", repositoryDirectory), "rendered video");
  await Bun.write(new URL(".tmp/demos/recording-full/pi-changes.json", repositoryDirectory), "{}");
  await Bun.write(new URL("packages/docs/public/demos/devtools.vtt", repositoryDirectory), "WEBVTT");
  await Bun.write(new URL("packages/docs/public/demos/devtools.mp4", repositoryDirectory), "guide video");
  await Bun.write(new URL("secret.txt", repositoryDirectory), "not media");
});

afterEach(async () => {
  await rm(Bun.fileURLToPath(repositoryDirectory), { recursive: true, force: true });
});

describe("createVideoRoutes", () => {
  test("lists the videos as JSON for the page", async () => {
    const response = await request("/demo-videos/index.json");

    expect(response.headers.get("content-type")).toStartWith("application/json");
    const videos: unknown = await response.json();
    assert(Array.isArray(videos));
    expect(videos.map((video: { src: unknown }) => video.src)).toEqual([
      "/demo-videos/recordings/recording-full/devhost-demo.mp4",
      "/demo-videos/guides/devtools.mp4",
    ]);
  });

  test("serves a listed video and its captions with their media types", async () => {
    const video = await request("/demo-videos/recordings/recording-full/devhost-demo.mp4");
    const captions = await request("/demo-videos/guides/devtools.vtt");

    expect({ type: video.headers.get("content-type"), body: await video.text() }).toEqual({
      type: "video/mp4",
      body: "rendered video",
    });
    expect({ type: captions.headers.get("content-type"), body: await captions.text() }).toEqual({
      type: "text/vtt",
      body: "WEBVTT",
    });
  });

  test("reads the disk again on each request, so a new render shows on reload", async () => {
    await Bun.write(new URL(".tmp/demos/recording-later/devhost-demo.mp4", repositoryDirectory), "second render");

    expect(await (await request("/demo-videos/recordings/recording-later/devhost-demo.mp4")).text()).toBe(
      "second render",
    );
  });

  test.each([
    "/demo-videos/recordings/recording-full/pi-changes.json",
    "/demo-videos/recordings/recording-full/../../../secret.txt",
    "/demo-videos/recordings/recording-full/..%2F..%2F..%2Fsecret.txt",
    "/demo-videos/guides/%2E%2E/%2E%2E/%2E%2E/%2E%2E/secret.txt",
    "/demo-videos/",
  ])("answers 404 for %s, which is not listed media", async (path) => {
    const response = await request(path);

    expect({ status: response.status, body: await response.text() }).toEqual({ status: 404, body: "Not Found" });
  });
});
