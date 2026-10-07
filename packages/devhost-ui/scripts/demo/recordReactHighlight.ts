import assert from "node:assert/strict";
import { join, relative } from "node:path";
import type { Page } from "playwright";
import { runCommand } from "./runCommand";
import { stopProcess } from "./stopProcess";
import type { ChangeCaption, IDemoRuntime } from "./types";

export async function recordReactHighlight(
  page: Page,
  runtime: IDemoRuntime,
  signal: AbortSignal,
  changeCaption: ChangeCaption,
): Promise<void> {
  const launchers = await Array.fromAsync(
    new Bun.Glob("**/bin/devhost-nvim").scan({ cwd: runtime.directoryPath, dot: true, onlyFiles: true }),
  );
  assert.equal(launchers.length, 1, "The stack must create exactly one native Neovim launcher");
  const relativeLauncher = launchers[0];
  assert(relativeLauncher);
  const projectPath = join(runtime.directoryPath, relativeLauncher.split(".tmp/devhost/")[0] ?? "");
  const socketPath = ".tmp/highlight.sock";
  const parserPath =
    process.env.DEVHOST_DEMO_TSX_PARSER ??
    join(process.env.XDG_DATA_HOME ?? join(process.env.HOME ?? "", ".local/share"), "nvim/site/parser/tsx.so");
  assert(await Bun.file(parserPath).exists(), "Install Neovim's TSX Tree-sitter parser or set DEVHOST_DEMO_TSX_PARSER");
  const sourcePath = runtime.env.DEVHOST_DEMO_EDIT_FILE;
  assert(sourcePath);
  const sourceLines = (await Bun.file(sourcePath).text()).split("\n");
  await page.evaluate(() => {
    window.addEventListener("devhost:react-highlight", (event) => {
      if (event instanceof CustomEvent) document.documentElement.dataset.demoHighlight = JSON.stringify(event.detail);
    });
  });
  const subprocess = Bun.spawn(
    [
      join(runtime.directoryPath, relativeLauncher),
      "--clean",
      "--headless",
      "--cmd",
      "set loadplugins",
      "--listen",
      socketPath,
      "--cmd",
      `lua vim.treesitter.language.add('tsx', {path=${JSON.stringify(parserPath)}})`,
      sourcePath,
      "-c",
      "packloadall!",
      "-c",
      "lua vim.treesitter.start(0, 'tsx')",
    ],
    {
      cwd: projectPath,
      env: runtime.env,
      stdin: "ignore",
      stdout: Bun.file(join(runtime.directoryPath, "nvim.stdout.log")),
      stderr: Bun.file(join(runtime.directoryPath, "nvim.stderr.log")),
    },
  );
  const options = { cwd: projectPath, env: runtime.env, signal, timeoutMs: 5_000 };
  try {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      signal.throwIfAborted();
      const isReady = await runCommand(["nvim", "--server", socketPath, "--remote-expr", "1"], options).then(
        () => true,
        () => false,
      );
      if (isReady) break;
      assert(subprocess.exitCode === null, "Neovim exited before its native server became ready");
      await Bun.sleep(100);
    }
    await page.waitForTimeout(2_000);
    for (const [needle, caption, name] of [
      ["<h1>", "Move to the heading in Neovim. Its live DOM element is highlighted.", "heading"],
      ["<p>", "Move the JSX cursor again. The browser highlight follows.", "paragraph"],
      ["<img src={logo}", "Source-map matching also connects JSX images to the live page.", "image"],
    ]) {
      assert(needle && caption && name);
      const index = sourceLines.findIndex((line) => line.includes(needle));
      const line = sourceLines[index];
      assert(index >= 0 && line);
      await runCommand(
        ["nvim", "--server", socketPath, "--remote-send", `<Esc>${index + 1}G${line.indexOf("<") + 1}|`],
        options,
      );
      const diagnostic = await runCommand(
        [
          "nvim",
          "--server",
          socketPath,
          "--remote-expr",
          'json_encode({"filetype": &filetype, "cursor": getcurpos(), "buffer": expand("%:p"), "lines": line("$"), "plugin": exists("#DevhostReactHighlight#CursorMoved"), "endpoint": $DEVHOST_REACT_HIGHLIGHT_URL, "node": luaeval("vim.treesitter.get_node({lang=\'tsx\'}):type()")})',
        ],
        options,
      );
      await Bun.write(join(runtime.directoryPath, `nvim-${name}.json`), diagnostic);
      await page.waitForFunction(
        (locator: string) => {
          const value = document.documentElement.dataset.demoHighlight;
          if (!value) return false;
          const detail: unknown = JSON.parse(value);
          return (
            typeof detail === "object" &&
            detail !== null &&
            "locator" in detail &&
            detail.locator === locator &&
            "matchedCount" in detail &&
            typeof detail.matchedCount === "number" &&
            detail.matchedCount > 0
          );
        },
        `${relative(projectPath, sourcePath)}:${index + 1}:${line.indexOf("<") + 1}`,
      );
      await page.locator("[data-devhost-react-highlight-overlay]").first().waitFor({ state: "visible" });
      await changeCaption(caption);
      await page.waitForTimeout(4_000);
      await page.screenshot({ path: join(runtime.directoryPath, `react-highlight-${name}.png`) });
    }
    await runCommand(["nvim", "--server", socketPath, "--remote-send", "<Esc>1G0"], options);
    await page.locator("[data-devhost-react-highlight-overlay]").waitFor({ state: "hidden" });
    await changeCaption("Move outside JSX to clear the highlight. Your page stays interactive.");
    await page.waitForTimeout(3_000);
  } finally {
    try {
      await Bun.write(
        join(runtime.directoryPath, "react-highlight-diagnostic.json"),
        await page.evaluate(() => document.documentElement.dataset.demoHighlight ?? "null"),
      );
    } finally {
      await stopProcess(subprocess);
    }
  }
}
