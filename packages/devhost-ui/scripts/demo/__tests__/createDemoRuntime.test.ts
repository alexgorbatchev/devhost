import { expect, it } from "bun:test";
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createDemoRuntime } from "../createDemoRuntime";
import { runCommand } from "../runCommand";

const repositoryPath = resolve(import.meta.dir, "../../../../..");

it("uses portless HTTPS and separate manifests for recordings on distinct hosts", async () => {
  const first = await createDemoRuntime(repositoryPath, "demo.localhost");
  const second = await createDemoRuntime(repositoryPath, "second-demo.localhost");
  try {
    expect(first.directoryPath).not.toBe(second.directoryPath);
    expect(first.manifestPath).not.toBe(second.manifestPath);
    expect(first.url).toBe("https://demo.localhost");
    expect(second.url).toBe("https://second-demo.localhost");
    expect(first.env.XDG_STATE_HOME).toBe(process.env.XDG_STATE_HOME);
    expect(first.env.DEVHOST_STATE_DIR).toBe(process.env.DEVHOST_STATE_DIR);
  } finally {
    await Promise.all([first, second].map((runtime) => rm(runtime.directoryPath, { recursive: true, force: true })));
  }
});

it.each(["example.com", "demo..localhost", "de..mo.localhost", "-demo.localhost", "demo-.localhost"])(
  "rejects invalid local host %s before creating a runtime",
  async (host) => {
    await expect(createDemoRuntime(repositoryPath, host)).rejects.toThrow(
      "Recording hostname must be a .localhost hostname",
    );
  },
);

it("copies the playground so agent edits cannot change the checkout's source", async () => {
  const sourcePath = join(repositoryPath, "packages/playground/frontend/src/components/PlaygroundLayout.tsx");
  const original = await Bun.file(sourcePath).text();
  const runtime = await createDemoRuntime(repositoryPath, "demo.localhost");
  try {
    const fixturePath = join(runtime.directoryPath, "playground/frontend/src/components/PlaygroundLayout.tsx");
    expect(await Bun.file(fixturePath).text()).toBe(original);
    const edited = original.replace("Devtools playground", "Local domains. Live fixes.");
    await Bun.write(fixturePath, edited);
    expect(await Bun.file(fixturePath).text()).toBe(edited);
    expect(await Bun.file(sourcePath).text()).toBe(original);
  } finally {
    await rm(runtime.directoryPath, { recursive: true, force: true });
  }
});

it("provides isolated usable Git worktrees for the recorded picker", async () => {
  const runtime = await createDemoRuntime(repositoryPath, "demo.localhost");
  const playgroundPath = join(runtime.directoryPath, "playground");
  try {
    expect((await runCommand(["git", "rev-parse", "--show-toplevel"], { cwd: playgroundPath })).trim()).toBe(
      playgroundPath,
    );
    const original = await Bun.file(join(playgroundPath, "frontend/src/components/PlaygroundLayout.tsx")).text();
    expect(
      await Bun.file(join(playgroundPath, ".workspaces/ui-polish/frontend/src/components/PlaygroundLayout.tsx")).text(),
    ).toBe(original);
    const worktrees = await runCommand(["git", "worktree", "list", "--porcelain"], { cwd: playgroundPath });
    expect(worktrees.split("\n").filter((line) => line.startsWith("branch "))).toEqual([
      "branch refs/heads/main",
      "branch refs/heads/ui-polish",
    ]);
  } finally {
    await rm(runtime.directoryPath, { recursive: true, force: true });
  }
});
