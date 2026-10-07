import { mkdir } from "node:fs/promises";
import { relative, resolve } from "node:path";

const projectTemporaryPath: string = resolve(import.meta.dir, "../../../.tmp");

/**
 * Builds the environment for a Chromium that a test launches with its own profile, so that the browser depends on
 * nothing in the real home directory and leaves nothing there.
 *
 * - `HOME` and `XDG_CONFIG_HOME` live inside the run directory, and the home already has a `Downloads` directory:
 *   Chromium cancels a download when its default download directory does not exist, as on a fresh CI runner.
 * - `TMPDIR` is the project `.tmp`, written relative to the working directory. Chromium fails to start when the
 *   path of its temporary directory is long: the absolute path of a nested checkout crashes it at launch, while a
 *   short path such as `/tmp` works.
 */
export async function createOwnedBrowserEnvironment(runDirectoryPath: string): Promise<NodeJS.ProcessEnv> {
  const homePath: string = resolve(runDirectoryPath, "home");

  await mkdir(resolve(homePath, "Downloads"), { recursive: true });
  await mkdir(projectTemporaryPath, { recursive: true });

  return {
    ...process.env,
    HOME: homePath,
    XDG_CONFIG_HOME: resolve(homePath, ".config"),
    TMPDIR: relative(process.cwd(), projectTemporaryPath),
  };
}
