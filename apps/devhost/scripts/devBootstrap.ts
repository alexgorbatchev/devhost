import { chmod, mkdir, mkdtemp, realpath, rename, rm } from "node:fs/promises";
import { isAbsolute, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

export async function devBootstrap(sourcePath: string, dotfilesPath: string): Promise<string> {
  const dotfilesDirectoryPath = await realpath(dotfilesPath);
  const shimPath = join(dotfilesDirectoryPath, ".generated/bin/devhost");
  const shimText = await Bun.file(shimPath).text();
  const assignments = [...shimText.matchAll(/^TOOL_EXECUTABLE=.*$/gm)];
  const payloadPath = /^TOOL_EXECUTABLE="([^"$`\\\r\n]+)"\r?$/m.exec(shimText)?.[1];

  if (assignments.length !== 1 || payloadPath === undefined || !isAbsolute(payloadPath)) {
    throw new Error("Devhost shim must contain one literal, absolute TOOL_EXECUTABLE path.");
  }

  const destinationPath = await realpath(payloadPath);
  const binariesDirectoryPath = await realpath(join(dotfilesDirectoryPath, ".generated/binaries"));

  if (!destinationPath.startsWith(binariesDirectoryPath + sep)) {
    throw new Error("Devhost payload must be inside the dotfiles binaries directory.");
  }

  const sourceFile = Bun.file(sourcePath);
  const sourceBytes = await sourceFile.bytes();

  if (sourceBytes.length === 0) {
    throw new Error("Build output is empty.");
  }

  const temporaryRootPath = join(dotfilesDirectoryPath, ".tmp");
  await mkdir(temporaryRootPath, { recursive: true });
  const temporaryDirectoryPath = await mkdtemp(join(temporaryRootPath, "devhost-bootstrap-"));
  const temporaryBinaryPath = join(temporaryDirectoryPath, "devhost");

  try {
    await Bun.write(temporaryBinaryPath, sourceBytes);
    await chmod(temporaryBinaryPath, 0o755);
    await rename(temporaryBinaryPath, destinationPath);
  } finally {
    await rm(temporaryDirectoryPath, { recursive: true, force: true });
  }

  return destinationPath;
}

if (import.meta.main) {
  const dotfilesPath = Bun.env.dotfiles_dir;

  if (dotfilesPath === undefined) {
    throw new Error("Run this script through just dev-bootstrap.");
  }

  const destinationPath = await devBootstrap(fileURLToPath(new URL("../bin/devhost", import.meta.url)), dotfilesPath);
  console.log(`Installed local devhost build at ${destinationPath}`);
}
