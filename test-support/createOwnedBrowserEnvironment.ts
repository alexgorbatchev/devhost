import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

/**
 * Builds the environment for a Chromium that a test launches, so that the browser depends on nothing in the real
 * home directory and leaves nothing there. Pass it as the `env` of the launch; the process that launches the
 * browser keeps its own environment, which Playwright needs to find its browsers.
 *
 * - `HOME` and `XDG_CONFIG_HOME` live inside the run directory, and the home already has a `Downloads` directory:
 *   Chromium cancels a download when its default download directory does not exist, as on a fresh CI runner.
 * - `TMPDIR` uses the OS temporary directory. Long checkout paths can crash Chromium at launch, while a short
 *   path such as `/tmp` works. The browser creates and cleans up its temporary files beneath that directory.
 *
 * `environment` is what the browser inherits otherwise; it defaults to the environment of this process.
 */
export async function createOwnedBrowserEnvironment(
  runDirectoryPath: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<NodeJS.ProcessEnv> {
  const homePath: string = resolve(runDirectoryPath, "home");
  const temporaryPath: string = tmpdir();

  await mkdir(resolve(homePath, "Downloads"), { recursive: true });
  await mkdir(temporaryPath, { recursive: true });

  return {
    ...environment,
    HOME: homePath,
    XDG_CONFIG_HOME: resolve(homePath, ".config"),
    TMPDIR: temporaryPath,
  };
}
