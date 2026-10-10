import { join, resolve } from "node:path";
import { describeDemoMediaProblem } from "./src/demoMedia/describeDemoMediaProblem";
import { fetchDemoMedia } from "./src/demoMedia/fetchDemoMedia";
import { inspectDemoMedia } from "./src/demoMedia/inspectDemoMedia";
import { publishDemoMedia } from "./src/demoMedia/publishDemoMedia";
import { readDemoMediaManifest } from "./src/demoMedia/readDemoMediaManifest";
import { runCommand } from "./src/demoMedia/runCommand";
import type { DemoMediaCommand } from "./src/demoMedia/types";

const docsPackagePath = import.meta.dir;
const manifestPath = join(docsPackagePath, "demo-media.json");
const directoryPath = join(docsPackagePath, "public/demos");

// Downloads the pinned videos this checkout does not hold yet.
async function fetchMedia(): Promise<void> {
  const results = await fetchDemoMedia({
    manifest: await readDemoMediaManifest(manifestPath),
    directoryPath,
    fetcher: (url) => fetch(url),
  });
  for (const { name, outcome } of results) {
    if (outcome === "downloaded") console.log(`Downloaded ${name}`);
    if (outcome === "different") console.warn(describeDemoMediaProblem({ name, state: "different" }));
  }
}

// Fails unless the videos on disk are exactly the pinned ones, which is what the published site will serve.
async function verifyMedia(): Promise<void> {
  const states = await inspectDemoMedia(await readDemoMediaManifest(manifestPath), directoryPath);
  const problems = states.map(describeDemoMediaProblem).filter((problem) => problem !== undefined);
  if (problems.length > 0) throw new Error(`The demo videos do not match demo-media.json:\n${problems.join("\n")}`);
}

// Uploads each new or re-rendered video to the media release and pins it.
async function publishMedia(): Promise<void> {
  const published = await publishDemoMedia({
    manifestPath,
    directoryPath,
    stagingPath: resolve(docsPackagePath, "../../.tmp/demo-media", Bun.randomUUIDv7()),
    run: runCommand,
  });
  if (published.length === 0) {
    console.log("Every demo video is already published.");
    return;
  }
  for (const name of published) console.log(`Published ${name}`);
  console.log("Commit packages/docs/demo-media.json with the guide changes.");
}

const commands: Record<string, DemoMediaCommand> = { fetch: fetchMedia, verify: verifyMedia, publish: publishMedia };
const command = commands[process.argv[2] ?? ""];
if (command === undefined) {
  console.error(`Usage: bun demoMedia.ts <${Object.keys(commands).join("|")}>`);
  process.exitCode = 2;
} else {
  try {
    await command();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
