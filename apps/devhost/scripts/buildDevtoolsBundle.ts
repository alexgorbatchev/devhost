import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { BunPlugin } from "bun";
import tailwindPlugin from "bun-plugin-tailwind";

const devtoolsEntrypointPath: string = fileURLToPath(
  new URL("../../../packages/devhost-ui/src/devtools/main.ts", import.meta.url),
);
const devtoolsStylesheetPath: string = fileURLToPath(
  new URL("../../../packages/devhost-ui/src/devtools/shared/devtools.css", import.meta.url),
);
const assetOutputDirectoryPath: string = fileURLToPath(new URL("../internal/devtools/dist/", import.meta.url));
const devtoolsScriptOutputPath: string = fileURLToPath(
  new URL("../internal/devtools/dist/devtools.js", import.meta.url),
);
const tsconfigPath: string = fileURLToPath(new URL("../../../packages/devhost-ui/tsconfig.json", import.meta.url));
const xtermStylesheetPath: string = fileURLToPath(
  new URL("../../../packages/devhost-ui/node_modules/@xterm/xterm/css/xterm.css", import.meta.url),
);
const xtermStylesheetOutputPath: string = fileURLToPath(
  new URL("../internal/devtools/dist/xterm.css", import.meta.url),
);

export async function buildDevtoolsBundle(): Promise<void> {
  const devtoolsStylesheetText: string = await buildDevtoolsStylesheet();
  const buildResult = await Bun.build({
    entrypoints: [devtoolsEntrypointPath],
    format: "esm",
    minify: true,
    plugins: [createInlineDevtoolsStylesheetPlugin(devtoolsStylesheetText)],
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

  await mkdir(assetOutputDirectoryPath, { recursive: true });
  await writeFile(devtoolsScriptOutputPath, scriptText);
  await writeFile(xtermStylesheetOutputPath, xtermStylesheetText);
}

async function buildDevtoolsStylesheet(): Promise<string> {
  const buildResult = await Bun.build({
    entrypoints: [devtoolsStylesheetPath],
    minify: true,
    plugins: [tailwindPlugin],
    target: "browser",
    throw: false,
  });

  if (!buildResult.success) {
    const logMessages: string = buildResult.logs.map((log) => log.message).join("\n");

    throw new Error(`Failed to build devtools stylesheet:\n${logMessages}`);
  }

  const stylesheetOutput = buildResult.outputs.at(0);

  if (stylesheetOutput === undefined) {
    throw new Error("Failed to build devtools stylesheet: no output was generated.");
  }

  return stylesheetOutput.text();
}

function createInlineDevtoolsStylesheetPlugin(stylesheetText: string): BunPlugin {
  return {
    name: "devhost-inline-devtools-stylesheet",
    setup(build): void {
      build.onResolve({ filter: /devtools\.css\?inline$/ }, () => {
        return {
          namespace: "devhost-inline-css",
          path: devtoolsStylesheetPath,
        };
      });
      build.onLoad({ filter: /.*/, namespace: "devhost-inline-css" }, () => {
        return {
          contents: `export default ${JSON.stringify(stylesheetText)};`,
          loader: "js",
        };
      });
    },
  };
}

if (import.meta.main) {
  await buildDevtoolsBundle();
}
