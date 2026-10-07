import { mkdir } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

const projectTemporaryPath: string = resolve(import.meta.dir, "../.tmp");

/**
 * Builds the environment for a Chromium that a test launches, so that the browser depends on nothing in the real
 * home directory and leaves nothing there. Pass it as the `env` of the launch; the process that launches the
 * browser keeps its own environment, which Playwright needs to find its browsers.
 *
 * - `HOME` and `XDG_CONFIG_HOME` live inside the run directory, and the home already has a `Downloads` directory:
 *   Chromium cancels a download when its default download directory does not exist, as on a fresh CI runner.
 * - `TMPDIR` is a relative path. Chromium fails to start when the path of its temporary directory is long: the
 *   absolute path of a nested checkout crashes it at launch, while a short path such as `/tmp` works. A relative
 *   `TMPDIR` in `environment` is kept; any other becomes the project `.tmp`, written relative to the working
 *   directory.
 *
 * `environment` is what the browser inherits otherwise; it defaults to the environment of this process.
 */
export async function createOwnedBrowserEnvironment(
  runDirectoryPath: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<NodeJS.ProcessEnv> {
  const homePath: string = resolve(runDirectoryPath, "home");
  const inheritedTemporaryPath: string | undefined = environment.TMPDIR;
  const hasRelativeTemporaryPath: boolean =
    inheritedTemporaryPath !== undefined && inheritedTemporaryPath !== "" && !isAbsolute(inheritedTemporaryPath);

  await mkdir(resolve(homePath, "Downloads"), { recursive: true });
  await mkdir(projectTemporaryPath, { recursive: true });

  return {
    ...environment,
    HOME: homePath,
    XDG_CONFIG_HOME: resolve(homePath, ".config"),
    TMPDIR: hasRelativeTemporaryPath ? inheritedTemporaryPath : relative(process.cwd(), projectTemporaryPath),
  };
}
