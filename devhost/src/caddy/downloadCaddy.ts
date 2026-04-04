import { chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { IManagedCaddyPaths } from "./caddyPaths";
import { managedCaddyPaths } from "./caddyPaths";
import type { IDevhostLogger } from "../utils/createLogger";

export interface IDownloadCaddyDependencies {
  chmod?: (path: string, mode: number) => Promise<void>;
  fetch?: typeof fetch;
  mkdir?: (path: string, options: { recursive?: boolean }) => Promise<string | undefined>;
  paths?: IManagedCaddyPaths;
  write?: (path: string, data: ArrayBuffer) => Promise<number>;
}

export async function downloadCaddy(
  logger: IDevhostLogger,
  osOverride?: string,
  archOverride?: string,
  dependencies: IDownloadCaddyDependencies = {},
): Promise<void> {
  const fetchImplementation = dependencies.fetch ?? globalThis.fetch;
  const mkdirImplementation = dependencies.mkdir ?? mkdir;
  const writeImplementation = dependencies.write ?? Bun.write;
  const chmodImplementation = dependencies.chmod ?? chmod;
  const paths = dependencies.paths ?? managedCaddyPaths;

  const os = osOverride ?? process.platform;
  let targetOs = "";
  if (os === "darwin") targetOs = "darwin";
  else if (os === "linux") targetOs = "linux";
  else if (os === "win32") targetOs = "windows";
  else throw new Error(`Unsupported OS: ${os}`);

  const arch = archOverride ?? process.arch;
  let targetArch = "";
  if (arch === "x64") targetArch = "amd64";
  else if (arch === "arm64") targetArch = "arm64";
  else if (arch === "arm") targetArch = "arm";
  else throw new Error(`Unsupported Architecture: ${arch}`);

  const extension = targetOs === "windows" ? ".exe" : "";
  const destFile = join(paths.caddyDirectoryPath, `caddy${extension}`);
  const url = `https://caddyserver.com/api/download?os=${targetOs}&arch=${targetArch}`;

  await mkdirImplementation(paths.caddyDirectoryPath, { recursive: true });

  logger.info(`Downloading Caddy for ${targetOs}-${targetArch} from ${url}...`);
  const response = await fetchImplementation(url);

  if (!response.ok) {
    throw new Error(`Failed to download Caddy: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  await writeImplementation(destFile, arrayBuffer);

  if (targetOs !== "windows") {
    await chmodImplementation(destFile, 0o755);
  }

  logger.info(`Caddy downloaded to ${destFile}`);
}
