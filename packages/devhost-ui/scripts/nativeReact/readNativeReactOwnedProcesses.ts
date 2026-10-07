import assert from "node:assert/strict";

interface INativeReactOwnedProcess {
  pid: number;
  command: string;
}

/** Select only argv containing this fresh run's unique browser/profile/configuration roots. */
export async function readNativeReactOwnedProcesses(roots: string[]): Promise<INativeReactOwnedProcess[]> {
  const child = Bun.spawn(["ps", "-eo", "pid,ppid,args"], { stdout: "pipe", stderr: "pipe", timeout: 5_000 });
  const [text, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  assert.equal(exit, 0, stderr);
  return text
    .split("\n")
    .filter((line) => roots.some((root) => line.includes(root)))
    .map((line) => {
      const match = /^\s*(\d+)\s+\d+\s+(.*)$/.exec(line);
      assert(match?.[1] && match[2], "Owned process snapshot could not be parsed.");
      return { pid: Number(match[1]), command: match[2] };
    });
}

export function isNativeReactOwnedProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") return false;
    throw error;
  }
}
