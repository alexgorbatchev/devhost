import { rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, mock } from "bun:test";
import { fetchDemoMedia } from "../fetchDemoMedia";
import type { DemoMediaFetcher } from "../types";
import { assetName, createManifest, createTestDirectory } from "./helpers";

let directoryPath = "";

beforeEach(async () => {
  directoryPath = join(await createTestDirectory(), "public/demos");
});

afterEach(async () => {
  await rm(join(directoryPath, "../.."), { recursive: true, force: true });
});

it("downloads a missing video from the release asset named after its content", async () => {
  const fetcher = mock<DemoMediaFetcher>().mockResolvedValue(new Response("annotations video"));

  const results = await fetchDemoMedia({
    manifest: createManifest({ "annotations.mp4": "annotations video" }),
    directoryPath,
    fetcher,
  });

  expect(results).toEqual([{ name: "annotations.mp4", outcome: "downloaded" }]);
  expect(fetcher.mock.calls).toEqual([
    [
      `https://github.com/alexgorbatchev/devhost/releases/download/media/${assetName("annotations", "annotations video")}`,
    ],
  ]);
  expect(await Bun.file(join(directoryPath, "annotations.mp4")).text()).toBe("annotations video");
});

it("requests nothing for a video that already matches its pin", async () => {
  await Bun.write(join(directoryPath, "devtools.mp4"), "devtools video");
  const fetcher = mock<DemoMediaFetcher>();

  const results = await fetchDemoMedia({
    manifest: createManifest({ "devtools.mp4": "devtools video" }),
    directoryPath,
    fetcher,
  });

  expect(results).toEqual([{ name: "devtools.mp4", outcome: "present" }]);
  expect(fetcher).not.toHaveBeenCalled();
});

it("keeps a local render that differs from its pin and reports it", async () => {
  await Bun.write(join(directoryPath, "devtools.mp4"), "a new render");
  const fetcher = mock<DemoMediaFetcher>();

  const results = await fetchDemoMedia({
    manifest: createManifest({ "devtools.mp4": "the published render" }),
    directoryPath,
    fetcher,
  });

  expect(results).toEqual([{ name: "devtools.mp4", outcome: "different" }]);
  expect(fetcher).not.toHaveBeenCalled();
  expect(await Bun.file(join(directoryPath, "devtools.mp4")).text()).toBe("a new render");
});

it("rejects a download that is not the pinned content and writes nothing", async () => {
  const manifest = createManifest({ "annotations.mp4": "annotations video" });
  const fetcher = mock<DemoMediaFetcher>().mockResolvedValue(new Response("something else"));
  const url = `https://github.com/alexgorbatchev/devhost/releases/download/media/${assetName("annotations", "annotations video")}`;

  await expect(fetchDemoMedia({ manifest, directoryPath, fetcher })).rejects.toThrow(
    `${url} is not the pinned annotations.mp4: expected sha256 ${manifest.files["annotations.mp4"]?.sha256}, received ${new Bun.CryptoHasher("sha256").update("something else").digest("hex")}`,
  );
  expect(await Bun.file(join(directoryPath, "annotations.mp4")).exists()).toBe(false);
});

it("names the asset and the status when the release does not serve it", async () => {
  const fetcher = mock<DemoMediaFetcher>().mockResolvedValue(new Response("Not Found", { status: 404 }));
  const url = `https://github.com/alexgorbatchev/devhost/releases/download/media/${assetName("annotations", "annotations video")}`;

  await expect(
    fetchDemoMedia({ manifest: createManifest({ "annotations.mp4": "annotations video" }), directoryPath, fetcher }),
  ).rejects.toThrow(`Cannot download annotations.mp4 from ${url}: HTTP 404`);
});
