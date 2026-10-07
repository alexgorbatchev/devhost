import { expect, it } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { stopProcess } from "../stopProcess";

it("lets the recorder finish its own cleanup after SIGINT", async () => {
  const parentPath = resolve(import.meta.dir, "../../../../../.tmp/demo-tests");
  await mkdir(parentPath, { recursive: true });
  const directoryPath = await mkdtemp(join(parentPath, "interrupt-"));
  const subprocess = Bun.spawn([process.execPath, join(import.meta.dir, "fixtures/browserInterrupt.ts")], {
    cwd: directoryPath,
    env: { ...process.env, TMPDIR: "." },
    stdout: "pipe",
    stderr: "pipe",
  });
  const reader = subprocess.stdout.getReader();
  try {
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("ready\n");
    reader.releaseLock();
    subprocess.kill("SIGINT");
    const [output, errors, exitCode] = await Promise.all([
      Array.fromAsync(subprocess.stdout).then((chunks) =>
        chunks.map((chunk) => new TextDecoder().decode(chunk)).join(""),
      ),
      new Response(subprocess.stderr).text(),
      subprocess.exited,
    ]);
    expect(errors).toBe("");
    expect(exitCode).toBe(0);
    expect(output).toBe("interrupted\nclosed:true\n");
  } finally {
    await stopProcess(subprocess);
    await rm(directoryPath, { recursive: true, force: true });
  }
}, 20_000);
