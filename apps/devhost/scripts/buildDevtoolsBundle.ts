import { mkdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { BunPlugin } from "bun";
import tailwindPlugin from "bun-plugin-tailwind";

const devtoolsEntrypointPath: string = fileURLToPath(
  new URL("../../../packages/devhost-ui/src/devtools/main.ts", import.meta.url),
);
const devtoolsStylesheetPath: string = fileURLToPath(
  new URL("../../../packages/devhost-ui/src/devtools/shared/devtools.css", import.meta.url),
);
const devtoolsStylesheetTextModuleImportPath: string = "./devtoolsCssText";
const assetOutputDirectoryPath: string = fileURLToPath(new URL("../internal/devtools/dist/", import.meta.url));
const tsconfigPath: string = fileURLToPath(new URL("../../../packages/devhost-ui/tsconfig.json", import.meta.url));
const xtermStylesheetPath: string = fileURLToPath(
  new URL("../../../packages/devhost-ui/node_modules/@xterm/xterm/css/xterm.css", import.meta.url),
);

interface IBuildDevtoolsBundleOptions {
  isProduction?: boolean;
  outputDirectoryPath?: string;
}

type BrowserBuildResult = Awaited<ReturnType<typeof Bun.build>>;

export async function buildDevtoolsBundle(options: IBuildDevtoolsBundleOptions = {}): Promise<void> {
  const outputDirectoryPath: string = options.outputDirectoryPath ?? assetOutputDirectoryPath;
  const isProduction: boolean = options.isProduction ?? true;
  const devtoolsStylesheetText: string = await buildDevtoolsStylesheet();
  const buildResult = await Bun.build({
    define: { "process.env.NODE_ENV": JSON.stringify(isProduction ? "production" : "development") },
    entrypoints: [devtoolsEntrypointPath],
    format: "esm",
    naming: { entry: "devtools.js", chunk: "assets/[name]-[hash].[ext]", asset: "assets/[name]-[hash].[ext]" },
    minify: true,
    outdir: outputDirectoryPath,
    plugins: [createInlineDevtoolsStylesheetPlugin(devtoolsStylesheetText)],
    publicPath: "/__devhost__/",
    splitting: true,
    target: "browser",
    throw: false,
    tsconfig: tsconfigPath,
  });

  if (!buildResult.success) {
    const logMessages: string = buildResult.logs.map((log) => log.message).join("\n");

    throw new Error(`Failed to build devtools script:\n${logMessages}`);
  }

  const reduxBuild = await buildReduxBrowserAsset("index.ts", "redux.js", outputDirectoryPath, isProduction);
  const reduxMonitorBuild = await buildReduxBrowserAsset(
    "startReduxDevtoolsMonitor.ts",
    "redux-monitor.js",
    outputDirectoryPath,
    isProduction,
  );
  await mkdir(outputDirectoryPath, { recursive: true });
  const outputNames = new Set<string>();
  for (const output of [...buildResult.outputs, ...reduxBuild.outputs, ...reduxMonitorBuild.outputs]) {
    const outputName: string = relative(outputDirectoryPath, output.path);
    outputNames.add(outputName);
    if (output.path.endsWith(".js")) {
      const compressedPath: string = `${output.path}.gz`;
      await Bun.write(compressedPath, Bun.gzipSync(await output.arrayBuffer()));
      outputNames.add(`${outputName}.gz`);
    }
  }
  await Bun.write(resolve(outputDirectoryPath, "xterm.css"), Bun.file(xtermStylesheetPath));
  outputNames.add("xterm.css");
  await Bun.write(
    resolve(outputDirectoryPath, "xterm.css.gz"),
    Bun.gzipSync(await Bun.file(xtermStylesheetPath).bytes()),
  );
  outputNames.add("xterm.css.gz");

  // Source-mode tabs may still request chunks from a previous page load. Release builds embed only the current graph.
  if (isProduction) {
    for await (const name of new Bun.Glob("**/*").scan(outputDirectoryPath)) {
      if (!outputNames.has(name)) await Bun.file(resolve(outputDirectoryPath, name)).delete();
    }
  }
}

async function buildReduxBrowserAsset(
  entrypoint: string,
  filename: string,
  outputDirectoryPath: string,
  isProduction: boolean,
): Promise<BrowserBuildResult> {
  const sourcePath: string = fileURLToPath(
    new URL(`../../../packages/devhost-ui/src/devtools/features/reduxDevtools/${entrypoint}`, import.meta.url),
  );
  const result = await Bun.build({
    define: { "process.env.NODE_ENV": JSON.stringify(isProduction ? "production" : "development") },
    entrypoints: [sourcePath],
    target: "browser",
    format: "esm",
    splitting: true,
    naming: { entry: filename, chunk: "assets/[name]-[hash].[ext]", asset: "assets/[name]-[hash].[ext]" },
    publicPath: "/__devhost__/",
    outdir: outputDirectoryPath,
    minify: true,
    throw: false,
    tsconfig: tsconfigPath,
  });
  if (!result.success || result.outputs.length === 0)
    throw new Error(`Failed to build ${filename}: ${result.logs.map(String).join("\n")}`);
  return result;
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
      build.onResolve({ filter: /^\.\/devtoolsCssText$/ }, ({ importer, path }) => {
        if (
          !importer.endsWith("/src/devtools/shared/devtoolsStyles.ts") ||
          path !== devtoolsStylesheetTextModuleImportPath
        ) {
          return;
        }

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
  await buildDevtoolsBundle({ isProduction: Bun.env.DEVHOST_DEVTOOLS_DEVELOPMENT !== "1" });
}
