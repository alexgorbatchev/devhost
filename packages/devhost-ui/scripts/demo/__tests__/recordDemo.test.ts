import { expect, it } from "bun:test";
import { join } from "node:path";
import { runCommand } from "../runCommand";

it("refuses unattended annotation recording before dependency checks or stack startup", async () => {
  const output = await runCommand([process.execPath, join(import.meta.dir, "fixtures/annotationPreflight.ts")], {
    env: { ...process.env, PATH: join(import.meta.dir, "fixtures/no-executables"), DEVHOST_DEMO_INTERACTIVE: "0" },
  });
  expect(output).toBe(
    "Annotation recording requires DEVHOST_DEMO_INTERACTIVE=1 and an operator to choose the current tab and review native permission requests\n",
  );
});
