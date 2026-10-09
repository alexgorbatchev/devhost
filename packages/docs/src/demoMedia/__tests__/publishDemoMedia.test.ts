import { readdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { afterEach, beforeEach, expect, it, mock } from "bun:test";
import { publishDemoMedia } from "../publishDemoMedia";
import type { IDemoMediaManifest, IPublishDemoMediaOptions, RunCommand } from "../types";
import { assetName, createManifest, createTestDirectory, hash } from "./helpers";

const view = ["gh", "release", "view", "media", "--repo", "alexgorbatchev/devhost", "--json", "assets"];

let testPath = "";
let options: Omit<IPublishDemoMediaOptions, "run"> = { manifestPath: "", directoryPath: "", stagingPath: "" };

function listAssets(assets: Record<string, string>): string {
  return JSON.stringify({
    assets: Object.entries(assets).map(([name, content]) => ({
      name,
      digest: `sha256:${hash(content)}`,
      state: "uploaded",
    })),
  });
}

async function writeManifest(files: Record<string, string>): Promise<string> {
  const text = `${JSON.stringify(createManifest(files), null, 2)}\n`;
  await Bun.write(options.manifestPath, text);
  return text;
}

function readManifest(): Promise<IDemoMediaManifest> {
  return Bun.file(options.manifestPath).json();
}

beforeEach(async () => {
  testPath = await createTestDirectory();
  options = {
    manifestPath: join(testPath, "demo-media.json"),
    directoryPath: join(testPath, "public/demos"),
    stagingPath: join(testPath, "staging"),
  };
});

afterEach(async () => {
  await rm(testPath, { recursive: true, force: true });
});

it("uploads only the videos whose content changed, named after that content, and pins them", async () => {
  await writeManifest({ "annotations.mp4": "old annotations", "devtools.mp4": "devtools video" });
  await Bun.write(join(options.directoryPath, "annotations.mp4"), "new annotations");
  await Bun.write(join(options.directoryPath, "devtools.mp4"), "devtools video");
  await Bun.write(join(options.directoryPath, "new-guide.mp4"), "new guide");
  await Bun.write(join(options.directoryPath, "new-guide.webp"), "poster");
  const annotations = assetName("annotations", "new annotations");
  const newGuide = assetName("new-guide", "new guide");
  const uploaded: Record<string, string> = {};
  const run = mock<RunCommand>()
    .mockResolvedValueOnce(listAssets({}))
    .mockImplementationOnce(async (command) => {
      // `gh` reads each staged file while this command runs.
      for (const path of command.slice(4, -2)) uploaded[basename(path)] = await Bun.file(path).text();
      return "";
    })
    .mockResolvedValueOnce(listAssets({ [annotations]: "new annotations", [newGuide]: "new guide" }));

  const published = await publishDemoMedia({ ...options, run });

  expect(published).toEqual(["annotations.mp4", "new-guide.mp4"]);
  expect(run.mock.calls.map((call) => call[0])).toEqual([
    view,
    [
      "gh",
      "release",
      "upload",
      "media",
      join(options.stagingPath, annotations),
      join(options.stagingPath, newGuide),
      "--repo",
      "alexgorbatchev/devhost",
    ],
    view,
  ]);
  expect(uploaded).toEqual({ [annotations]: "new annotations", [newGuide]: "new guide" });
  expect(await readManifest()).toEqual(
    createManifest({
      "annotations.mp4": "new annotations",
      "devtools.mp4": "devtools video",
      "new-guide.mp4": "new guide",
    }),
  );
  expect(await readdir(options.stagingPath).catch((): string[] => [])).toEqual([]);
});

it("pins a video the release already holds without uploading it again", async () => {
  await writeManifest({ "annotations.mp4": "old annotations" });
  await Bun.write(join(options.directoryPath, "annotations.mp4"), "new annotations");
  const run = mock<RunCommand>().mockResolvedValue(
    listAssets({ [assetName("annotations", "new annotations")]: "new annotations" }),
  );

  const published = await publishDemoMedia({ ...options, run });

  expect(published).toEqual(["annotations.mp4"]);
  expect(run.mock.calls.map((call) => call[0])).toEqual([view]);
  expect(await readManifest()).toEqual(createManifest({ "annotations.mp4": "new annotations" }));
});

it("runs nothing and leaves the manifest alone when every video matches its pin", async () => {
  const manifest = await writeManifest({ "annotations.mp4": "annotations video" });
  await Bun.write(join(options.directoryPath, "annotations.mp4"), "annotations video");
  const run = mock<RunCommand>();

  const published = await publishDemoMedia({ ...options, run });

  expect(published).toEqual([]);
  expect(run).not.toHaveBeenCalled();
  expect(await Bun.file(options.manifestPath).text()).toBe(manifest);
});

it("keeps the pin of a video that is not on disk", async () => {
  await writeManifest({ "annotations.mp4": "old annotations", "devtools.mp4": "devtools video" });
  await Bun.write(join(options.directoryPath, "annotations.mp4"), "new annotations");
  const run = mock<RunCommand>().mockResolvedValue(
    listAssets({ [assetName("annotations", "new annotations")]: "new annotations" }),
  );

  await publishDemoMedia({ ...options, run });

  expect(await readManifest()).toEqual(
    createManifest({ "annotations.mp4": "new annotations", "devtools.mp4": "devtools video" }),
  );
});

it("pins nothing when the release reports other content for an upload", async () => {
  const manifest = await writeManifest({ "annotations.mp4": "old annotations" });
  await Bun.write(join(options.directoryPath, "annotations.mp4"), "new annotations");
  const asset = assetName("annotations", "new annotations");
  const run = mock<RunCommand>()
    .mockResolvedValueOnce(listAssets({}))
    .mockResolvedValueOnce("")
    .mockResolvedValueOnce(listAssets({ [asset]: "truncated" }));

  await expect(publishDemoMedia({ ...options, run })).rejects.toThrow(
    `Release media holds ${asset} as sha256:${hash("truncated")}, not sha256:${hash("new annotations")}`,
  );
  expect(await Bun.file(options.manifestPath).text()).toBe(manifest);
});

it("pins nothing when the release does not list an upload", async () => {
  const manifest = await writeManifest({ "annotations.mp4": "old annotations" });
  await Bun.write(join(options.directoryPath, "annotations.mp4"), "new annotations");
  const run = mock<RunCommand>().mockResolvedValue(listAssets({}));

  await expect(publishDemoMedia({ ...options, run })).rejects.toThrow(
    `Release media does not hold ${assetName("annotations", "new annotations")} after the upload`,
  );
  expect(await Bun.file(options.manifestPath).text()).toBe(manifest);
});
