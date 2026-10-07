import { expect, it } from "bun:test";
import { runCommand } from "../runCommand";

it("captures a real command's output", async () => {
  expect(await runCommand([process.execPath, "-e", "console.log('recording ready')"])).toBe("recording ready\n");
});

it("rejects failed commands with their exit code and diagnostics", async () => {
  await expect(
    runCommand([process.execPath, "-e", "console.error('encoder failed'); process.exit(7)"]),
  ).rejects.toThrow("Command failed (7): encoder failed");
});

it("terminates commands that exceed their deadline", async () => {
  await expect(runCommand([process.execPath, "-e", "setInterval(() => {}, 1000)"], { timeoutMs: 100 })).rejects.toThrow(
    "Command timed out after 100ms",
  );
});
