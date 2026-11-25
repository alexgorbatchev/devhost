import { realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";

async function runCommand(command: string[], directoryPath: string): Promise<string> {
  const child = Bun.spawn(command, { cwd: directoryPath, env: process.env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`${command[0]} failed: ${stderr.trim() || stdout.trim() || `exit ${exitCode}`}`);
  }
  return stdout.trim();
}

export async function devBootstrap(sourcePath: string, dotfilesPath: string): Promise<string> {
  const dotfilesDirectoryPath = await realpath(dotfilesPath);
  try {
    const help = await runCommand(["dotfiles", "tool", "dev", "use", "--help"], dotfilesDirectoryPath);
    if (!help.includes("--bin")) {
      throw new Error("tool dev use --bin is unavailable");
    }
  } catch (error) {
    throw new Error("Update dotfiles to a version supporting 'tool dev use' before bootstrapping.", { cause: error });
  }

  const sourceBinaryPath = await realpath(sourcePath);
  if (Bun.file(sourceBinaryPath).size === 0) {
    throw new Error("Build output is empty.");
  }
  const sourceRepositoryPath = await realpath(fileURLToPath(new URL("../../../", import.meta.url)));
  const version = await runCommand([sourceBinaryPath, "--version"], sourceRepositoryPath);
  await runCommand(
    [
      "dotfiles",
      "tool",
      "dev",
      "use",
      "devhost",
      "--bin",
      "devhost=" + sourceBinaryPath,
      "--source-repo",
      sourceRepositoryPath,
      "--version",
      version,
    ],
    dotfilesDirectoryPath,
  );
  return runCommand(["dotfiles", "tool", "which", "devhost", "--bin"], dotfilesDirectoryPath);
}

if (import.meta.main) {
  const dotfilesPath = Bun.env.dotfiles_dir;
  if (dotfilesPath === undefined) {
    throw new Error("Run this script through just dev-bootstrap.");
  }
  const destinationPath = await devBootstrap(
    fileURLToPath(new URL("../target/release/devhost", import.meta.url)),
    dotfilesPath,
  );
  console.log(`Registered local devhost build at ${destinationPath}`);
}
