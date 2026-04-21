import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const devtoolsEntrypointPath: string = fileURLToPath(new URL("../src/devtools/main.ts", import.meta.url));
const goAssetOutputPath: string = fileURLToPath(new URL("../internal/devtools/assets_generated.go", import.meta.url));
const tsconfigPath: string = fileURLToPath(new URL("../tsconfig.json", import.meta.url));
const xtermStylesheetPath: string = fileURLToPath(
  new URL("../node_modules/@xterm/xterm/css/xterm.css", import.meta.url),
);

export async function buildDevtoolsBundle(): Promise<void> {
  const buildResult = await Bun.build({
    entrypoints: [devtoolsEntrypointPath],
    format: "esm",
    minify: true,
    splitting: false,
    target: "browser",
    throw: false,
    tsconfig: tsconfigPath,
  });

  if (!buildResult.success) {
    const logMessages: string = buildResult.logs.map((log) => log.message).join("\n");

    throw new Error(`Failed to build devtools script:\n${logMessages}`);
  }

  const scriptOutput = buildResult.outputs.at(0);

  if (scriptOutput === undefined) {
    throw new Error("Failed to build devtools script: no output was generated.");
  }

  const scriptText: string = await scriptOutput.text();
  const xtermStylesheetText: string = await readFile(xtermStylesheetPath, "utf8");

  await writeFile(goAssetOutputPath, createGoAssetSource(scriptText, xtermStylesheetText));
}

function createGoAssetSource(scriptText: string, xtermStylesheetText: string): string {
  return [
    "package devtools",
    "",
    `const bundledDevtoolsScript = ${JSON.stringify(scriptText)}`,
    "",
    `const bundledXtermStylesheet = ${JSON.stringify(xtermStylesheetText)}`,
    "",
  ].join("\n");
}

if (import.meta.main) {
  await buildDevtoolsBundle();
}
