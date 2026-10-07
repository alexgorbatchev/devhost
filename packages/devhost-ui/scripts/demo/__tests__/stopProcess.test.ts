import { expect, it } from "bun:test";
import { stopProcess } from "../stopProcess";

it("lets a process finish its SIGTERM cleanup", async () => {
  const subprocess = Bun.spawn(
    [
      process.execPath,
      "-e",
      "process.on('SIGTERM', () => { console.log('cleaned up'); process.exit(0) }); console.log('ready'); setInterval(() => {}, 1000)",
    ],
    { stdout: "pipe" },
  );
  const reader = subprocess.stdout.getReader();
  await reader.read();
  await stopProcess(subprocess, 1_000);
  expect(new TextDecoder().decode((await reader.read()).value)).toBe("cleaned up\n");
  expect(subprocess.exitCode).toBe(0);
});

it("kills a process that ignores SIGTERM after the grace period", async () => {
  const subprocess = Bun.spawn(
    [process.execPath, "-e", "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000)"],
    { stdout: "pipe" },
  );
  await subprocess.stdout.getReader().read();
  await stopProcess(subprocess, 50);
  expect(subprocess.signalCode).toBe("SIGKILL");
});
