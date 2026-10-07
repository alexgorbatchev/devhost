import { afterEach, beforeEach, expect, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import { createOwnedBrowserEnvironment } from "../createOwnedBrowserEnvironment";

const projectTemporaryPath: string = resolve(import.meta.dir, "../../../../.tmp");
let runDirectoryPath: string;

beforeEach(async () => {
  const parentPath: string = join(projectTemporaryPath, "owned-browser-environment");

  await mkdir(parentPath, { recursive: true });
  runDirectoryPath = await mkdtemp(join(parentPath, "run-"));
});

afterEach(async () => {
  await rm(runDirectoryPath, { recursive: true, force: true });
});

test("gives the browser a home inside the run directory that already has a Downloads directory", async () => {
  const environment = await createOwnedBrowserEnvironment(runDirectoryPath);

  expect(environment.HOME).toBe(join(runDirectoryPath, "home"));
  expect(environment.XDG_CONFIG_HOME).toBe(join(runDirectoryPath, "home", ".config"));
  expect((await stat(join(runDirectoryPath, "home", "Downloads"))).isDirectory()).toBe(true);
});

test("points the browser's temporary directory at the project .tmp through a relative path", async () => {
  const environment = await createOwnedBrowserEnvironment(runDirectoryPath);

  assert(environment.TMPDIR !== undefined);
  expect(isAbsolute(environment.TMPDIR)).toBe(false);
  expect(resolve(process.cwd(), environment.TMPDIR)).toBe(projectTemporaryPath);
});

test("keeps the variables of the process that launches the browser", async () => {
  const environment = await createOwnedBrowserEnvironment(runDirectoryPath);

  expect(environment.PATH).toBe(process.env.PATH);
});
