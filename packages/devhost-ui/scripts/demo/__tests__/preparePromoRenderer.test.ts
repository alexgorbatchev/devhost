import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, expect, it, mock } from "bun:test";
import { preparePromoRenderer } from "../preparePromoRenderer";
import type { RunCommand } from "../types";

const otherRunInstall = "bunx-1000-hyperframes@0.8.143/node_modules/hyperframes/cli.js";

let testsPath = "";
let sharedPath = "";

function createRunner(nodeVersion: string): ReturnType<typeof mock<RunCommand>> {
  // The first command asks Node.js for its version; later ones print nothing the caller reads.
  return mock<RunCommand>().mockResolvedValueOnce(`${nodeVersion}\n`).mockResolvedValue("");
}

function listFiles(directoryPath: string): Promise<string[]> {
  return Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: directoryPath, dot: true }));
}

beforeAll(async () => {
  const parentPath = resolve(import.meta.dir, "../../../../../.tmp/demo-tests");
  await mkdir(parentPath, { recursive: true });
  testsPath = await mkdtemp(join(parentPath, "preflight-"));
});

beforeEach(async () => {
  // Recordings started together share one directory, and another run's renderer is already installed in it.
  sharedPath = await mkdtemp(join(testsPath, "demos-"));
  await Bun.write(join(sharedPath, otherRunInstall), "cli");
});

afterAll(async () => {
  await rm(testsPath, { recursive: true, force: true });
});

it("fetches the renderer's browser through the project's pinned script before anything is captured", async () => {
  const run = createRunner("v24.14.1");
  const signal = new AbortController().signal;

  await preparePromoRenderer(run, "/checkout/promo", sharedPath, signal);

  expect(run.mock.calls.map((call) => call[0])).toEqual([
    ["node", "--version"],
    ["bun", "run", "browser"],
  ]);
  const options = run.mock.calls[1]?.[1];
  expect(options?.cwd).toBe("/checkout/promo");
  expect(options?.signal).toBe(signal);
  expect({
    telemetry: options?.env?.HYPERFRAMES_NO_TELEMETRY,
    skills: options?.env?.HYPERFRAMES_SKIP_SKILLS,
    temporaryParent: dirname(options?.env?.TMPDIR ?? ""),
  }).toEqual({ telemetry: "1", skills: "1", temporaryParent: sharedPath });
});

it("installs the renderer in a directory of its own and removes only that directory", async () => {
  const installed: string[][] = [];
  const run = createRunner("v24.14.1").mockImplementationOnce(async (_command, options) => {
    const ownPath = options?.env?.TMPDIR ?? "";
    await Bun.write(join(ownPath, "bunx-1000-hyperframes@0.8.143/package.json"), "{}");
    installed.push(await readdir(ownPath));
    return "";
  });

  await preparePromoRenderer(run, "/checkout/promo", sharedPath, new AbortController().signal);

  expect(installed).toEqual([["bunx-1000-hyperframes@0.8.143"]]);
  expect(await listFiles(sharedPath)).toEqual([otherRunInstall]);
});

it("gives two preflights that run together different directories", async () => {
  const first = createRunner("v24.14.1");
  const second = createRunner("v24.14.1");
  const signal = new AbortController().signal;

  await Promise.all([
    preparePromoRenderer(first, "/checkout/promo", sharedPath, signal),
    preparePromoRenderer(second, "/checkout/promo", sharedPath, signal),
  ]);

  expect(first.mock.calls[1]?.[1]?.env?.TMPDIR).not.toBe(second.mock.calls[1]?.[1]?.env?.TMPDIR);
});

it("removes its directory when the browser download fails", async () => {
  const run = mock<RunCommand>()
    .mockResolvedValueOnce("v24.14.1\n")
    .mockRejectedValueOnce(new Error("Chrome download failed"));

  await expect(preparePromoRenderer(run, "/checkout/promo", sharedPath, new AbortController().signal)).rejects.toThrow(
    "Chrome download failed",
  );
  expect(await listFiles(sharedPath)).toEqual([otherRunInstall]);
});

it("creates the shared directory on a checkout that has never recorded", async () => {
  const neverRecordedPath = join(sharedPath, "never-recorded");
  const run = createRunner("v24.14.1");

  await preparePromoRenderer(run, "/checkout/promo", neverRecordedPath, new AbortController().signal);

  expect(dirname(run.mock.calls[1]?.[1]?.env?.TMPDIR ?? "")).toBe(neverRecordedPath);
});

it("stops before the browser download when Node.js is older than the renderer supports", async () => {
  const run = createRunner("v20.11.0");

  await expect(preparePromoRenderer(run, "/checkout/promo", sharedPath, new AbortController().signal)).rejects.toThrow(
    "The promo's renderer needs Node.js 22 or newer; found v20.11.0",
  );
  expect(run).toHaveBeenCalledTimes(1);
  expect(await listFiles(sharedPath)).toEqual([otherRunInstall]);
});

it("rejects a Node.js version it cannot read", async () => {
  const run = createRunner("node: command output changed");

  await expect(preparePromoRenderer(run, "/checkout/promo", sharedPath, new AbortController().signal)).rejects.toThrow(
    "Cannot read the Node.js version from: node: command output changed",
  );
});
