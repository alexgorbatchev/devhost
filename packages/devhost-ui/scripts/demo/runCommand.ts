import type { CommandOptions } from "./types";

export async function runCommand(command: string[], options: CommandOptions = {}): Promise<string> {
  options.signal?.throwIfAborted();
  const subprocess = Bun.spawn(command, {
    cwd: options.cwd,
    env: options.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    signal: options.signal,
  });
  const timeoutMs = options.timeoutMs ?? 120_000;
  let hasTimedOut = false;
  const timeout = setTimeout(() => {
    hasTimedOut = true;
    subprocess.kill("SIGKILL");
  }, timeoutMs);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(subprocess.stdout).text(),
      new Response(subprocess.stderr).text(),
      subprocess.exited,
    ]);
    if (options.logPath) await Bun.write(options.logPath, stdout + stderr);
    if (hasTimedOut) {
      throw new Error(`Command timed out after ${timeoutMs}ms`);
    }
    options.signal?.throwIfAborted();
    if (exitCode !== 0) {
      throw new Error(`Command failed (${exitCode}): ${[stderr.trim(), stdout.trim()].filter(Boolean).join("\n")}`);
    }
    return stdout;
  } finally {
    clearTimeout(timeout);
  }
}
