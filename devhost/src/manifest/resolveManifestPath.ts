import { access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export async function resolveManifestPath(startDirectoryPath: string): Promise<string> {
  let currentDirectoryPath: string = resolve(startDirectoryPath);

  while (true) {
    const manifestPath: string = join(currentDirectoryPath, "devhost.toml");

    if (await doesPathExist(manifestPath)) {
      return manifestPath;
    }

    const isRepositoryRoot: boolean = await doesPathExist(join(currentDirectoryPath, ".git"));
    const parentDirectoryPath: string = dirname(currentDirectoryPath);

    if (isRepositoryRoot || parentDirectoryPath === currentDirectoryPath) {
      break;
    }

    currentDirectoryPath = parentDirectoryPath;
  }

  throw new Error(`Could not find devhost.toml from ${startDirectoryPath} upward.`);
}

async function doesPathExist(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
