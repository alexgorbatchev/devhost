import { expect, it } from "bun:test";
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createDemoRuntime } from "../createDemoRuntime";
import { restoreDemoPlayground } from "../restoreDemoPlayground";

it("restores the recorded source and retains the actual agent edit for review", async () => {
  const runtime = await createDemoRuntime(resolve(import.meta.dir, "../../../../.."), "demo.localhost");
  const file = "frontend/src/components/PlaygroundLayout.tsx";
  const fixturePath = join(runtime.directoryPath, "playground", file);
  try {
    const original = await Bun.file(fixturePath).text();
    const edited = original.replace("Devtools playground", "Local domains. Live fixes.");
    await Bun.write(fixturePath, edited);
    await restoreDemoPlayground(runtime);
    expect(await Bun.file(fixturePath).text()).toBe(original);
    expect(await Bun.file(join(runtime.directoryPath, "pi-changes.json")).json()).toEqual({ [file]: edited });
  } finally {
    await rm(runtime.directoryPath, { recursive: true, force: true });
  }
});
