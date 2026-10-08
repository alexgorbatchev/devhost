import { tmpdir } from "node:os";
import { E2E_TEMPORARY_PATH } from "../../../../test-support/constants";
import { afterEach, beforeEach, expect, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import { createOwnedBrowserEnvironment } from "../../../../test-support/createOwnedBrowserEnvironment";

const projectTemporaryPath: string = E2E_TEMPORARY_PATH;
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
  const environment = await createOwnedBrowserEnvironment(runDirectoryPath, {});

  expect(environment.HOME).toBe(join(runDirectoryPath, "home"));
  expect(environment.XDG_CONFIG_HOME).toBe(join(runDirectoryPath, "home", ".config"));
  expect((await stat(join(runDirectoryPath, "home", "Downloads"))).isDirectory()).toBe(true);
});

test("uses the OS temporary directory for browser-created temporary files", async () => {
  const environment = await createOwnedBrowserEnvironment(runDirectoryPath, {});

  assert(environment.TMPDIR !== undefined);
  expect(resolve(process.cwd(), environment.TMPDIR)).toBe(tmpdir());
  expect((await stat(resolve(process.cwd(), environment.TMPDIR))).isDirectory()).toBe(true);
});

test("replaces an absolute temporary directory, whose length Chromium may not survive", async () => {
  const environment = await createOwnedBrowserEnvironment(runDirectoryPath, {
    TMPDIR: join(runDirectoryPath, "absolute-temporary-directory"),
  });

  assert(environment.TMPDIR !== undefined);
  expect(resolve(process.cwd(), environment.TMPDIR)).toBe(tmpdir());
});

test("isolates an inherited repository-relative temporary directory", async () => {
  const environment = await createOwnedBrowserEnvironment(runDirectoryPath, { TMPDIR: ".tmp" });

  assert(environment.TMPDIR !== undefined);
  expect(resolve(process.cwd(), environment.TMPDIR)).toBe(tmpdir());
});

test("keeps the other variables the browser would inherit", async () => {
  const environment = await createOwnedBrowserEnvironment(runDirectoryPath, { PATH: "/usr/bin" });

  expect(environment.PATH).toBe("/usr/bin");
});

test("starts from the environment of the launching process when none is given", async () => {
  const environment = await createOwnedBrowserEnvironment(runDirectoryPath);

  expect(environment.PATH).toBe(process.env.PATH);
});
