import { join } from "node:path";
import type { IDemoRuntime } from "./types";

// A recording that owns its Caddy also owns the devhost config file setting that Caddy's listeners, so applying it
// cannot change the user's shared Caddy. The admin endpoint names the Caddy the recording owns.
export async function applyPrivateDemoCaddyConfig(runtime: IDemoRuntime, caddyLines: string[] = []): Promise<void> {
  const configDirectoryPath = join(runtime.directoryPath, "config", "devhost");
  runtime.env.DEVHOST_CONFIG_DIR = configDirectoryPath;
  const lines = ["[caddy]", `adminAddress = "${runtime.adminAddress}"`, ...caddyLines];
  await Bun.write(join(configDirectoryPath, "config.toml"), `${lines.join("\n")}\n`);
}
