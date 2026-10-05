import { expect, it } from "bun:test";
import { resolve } from "node:path";

it("prints the workspace command when requesting release build help", async () => {
  const command = Bun.spawn(["just", "devhost", "build-release-artifacts", "--help"], {
    cwd: resolve(import.meta.dir, "../../../.."),
    stdout: "pipe",
    stderr: "pipe",
  });

  expect(await new Response(command.stdout).text()).toBe(
    "Usage: just devhost build-release-artifacts [--targets=<comma-separated targets>]\n" +
      "Default targets: darwin-arm64, linux-x64, linux-arm64, linux-x64-musl, linux-arm64-musl\n",
  );
  await new Response(command.stderr).text();
  expect(await command.exited).toBe(0);
});
