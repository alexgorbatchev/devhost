import { expect, it } from "bun:test";
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createDemoRuntime } from "../createDemoRuntime";
import { applyPrivateDemoCaddyConfig } from "../applyPrivateDemoCaddyConfig";

const repositoryPath = resolve(import.meta.dir, "../../../../..");

it("gives a recording that owns its Caddy a devhost config file of its own", async () => {
  const runtime = await createDemoRuntime(repositoryPath, "demo.localhost");
  try {
    runtime.adminAddress = "127.0.0.1:43123";
    await applyPrivateDemoCaddyConfig(runtime, ["http = true", "httpsPort = 43124"]);
    const configDirectoryPath = join(runtime.directoryPath, "config/devhost");
    expect(runtime.env.DEVHOST_CONFIG_DIR).toBe(configDirectoryPath);
    expect(Bun.TOML.parse(await Bun.file(join(configDirectoryPath, "config.toml")).text())).toEqual({
      caddy: { adminAddress: "127.0.0.1:43123", http: true, httpsPort: 43124 },
    });
  } finally {
    await rm(runtime.directoryPath, { recursive: true, force: true });
  }
});
