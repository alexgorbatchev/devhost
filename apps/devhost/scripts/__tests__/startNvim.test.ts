import { afterEach, expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

const repositoryPath = resolve(import.meta.dir, "../../../..");
const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

it("prints the workspace command when requesting Neovim help", async () => {
  const command = Bun.spawn(["just", "devhost", "nvim", "--help"], {
    cwd: repositoryPath,
    stdout: "pipe",
    stderr: "pipe",
  });

  expect(await new Response(command.stdout).text()).toBe(
    "Usage: just devhost nvim [--project=<path>] [--stack=<name>] [nvim args...]\n\n" +
      "Launches the devhost-generated Neovim wrapper for a running stack.\n",
  );
  await new Response(command.stderr).text();
  expect(await command.exited).toBe(0);
});

it("suggests the workspace command when multiple stacks have launchers", async () => {
  const temporaryRootPath = join(repositoryPath, ".tmp");
  await mkdir(temporaryRootPath, { recursive: true });
  const projectPath = await mkdtemp(join(temporaryRootPath, "nvim-command-"));
  temporaryPaths.push(projectPath);
  await Bun.write(join(projectPath, ".tmp/devhost/first/nvim-shell/bin/devhost-nvim"), "#!/bin/sh\n");
  await Bun.write(join(projectPath, ".tmp/devhost/second/nvim-shell/bin/devhost-nvim"), "#!/bin/sh\n");
  const stackNames = await readdir(join(projectPath, ".tmp/devhost"));
  const environment = { ...process.env };
  delete environment.DEVHOST_STACK_NAME;
  const command = Bun.spawn(["bun", resolve(import.meta.dir, "../startNvim.ts"), `--project=${projectPath}`], {
    env: environment,
    stdout: "pipe",
    stderr: "pipe",
  });

  expect(await new Response(command.stdout).text()).toBe("");
  expect(await new Response(command.stderr).text()).toBe(
    `Multiple devhost Neovim launchers exist under ${projectPath}/.tmp/devhost: ${stackNames.join(", ")}.\n` +
      "Select one with: just devhost nvim --stack=<stack-name>\n",
  );
  expect(await command.exited).toBe(1);
});
