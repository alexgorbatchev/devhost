import { mkdir, mkdtemp } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { DemoRuntime } from "./types";
import { createDemoPlayground } from "./createDemoPlayground";
import { createPiDemoFiles } from "./createPiDemoFiles";
import { createDemoWorktrees } from "./createDemoWorktrees";

export async function createDemoRuntime(repositoryPath: string, host: string): Promise<DemoRuntime> {
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+localhost$/.test(host)) {
    throw new Error("Recording hostname must be a .localhost hostname");
  }
  const parentPath = join(repositoryPath, ".tmp/demos");
  await mkdir(parentPath, { recursive: true });
  const directoryPath = await mkdtemp(join(parentPath, "recording-"));
  await Promise.all(["raw", "clips", "bin", ".tmp"].map((directory) => mkdir(join(directoryPath, directory))));
  const adminAddress = process.env.DEVHOST_DEMO_ADMIN ?? "127.0.0.1:20197";
  const sourcePath = resolve(import.meta.dir, "devhost.toml");
  const manifestPath = join(directoryPath, "devhost.toml");
  await Bun.write(manifestPath, Bun.file(sourcePath));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AGENT: "0",
    DEVHOST_MANIFEST: manifestPath,
    DEVHOST_DEMO_ROOT: repositoryPath,
    DEVHOST_DEMO_RUNTIME: directoryPath,
    DEVHOST_DEMO_EDIT_FILE: join(directoryPath, "playground/frontend/src/components/PlaygroundLayout.tsx"),
    DEVHOST_DEMO_HOST: host,
    DEVHOST_DEMO_ADMIN: adminAddress,
    XDG_DATA_HOME: join(directoryPath, "data"),
    XDG_CONFIG_HOME: join(directoryPath, "config"),
    TMPDIR: ".tmp",
    PATH: `${join(directoryPath, "bin")}:${process.env.PATH ?? ""}`,
    VHS_PUBLISH: "false",
  };
  delete env.DEVHOST_DEV_SOURCE_DIR;
  delete env.DEVHOST_IDLE_TIMEOUT;
  const runtime: DemoRuntime = {
    directoryPath,
    repositoryPath,
    manifestPath,
    adminAddress,
    certificatePath: join(directoryPath, "caddy-root.crt"),
    url: `https://${host}`,
    env,
  };
  await createDemoPlayground(runtime);
  await createDemoWorktrees(runtime);
  await createPiDemoFiles(runtime);
  return runtime;
}
