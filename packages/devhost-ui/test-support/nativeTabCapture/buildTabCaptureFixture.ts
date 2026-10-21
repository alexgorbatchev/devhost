import assert from "node:assert/strict";
import { resolve } from "node:path";
import tailwindPlugin from "bun-plugin-tailwind";

export async function buildTabCaptureFixture(outputPath: string): Promise<void> {
  const packageRoot = resolve(import.meta.dir, "../..");
  const stylesheet = await Bun.build({
    entrypoints: [resolve(packageRoot, "src/devtools/shared/devtools.css")],
    plugins: [tailwindPlugin],
    minify: true,
    target: "browser",
  });
  assert(stylesheet.success, stylesheet.logs.map(String).join("\n"));
  const css = stylesheet.outputs.find((output) => output.path.endsWith(".css"));
  assert(css, "The actual devtools stylesheet must build for native capture acceptance.");
  const result = await Bun.build({
    entrypoints: [resolve(import.meta.dir, "__tests__/fixtures/mountTabCaptureFixture.tsx")],
    outdir: outputPath,
    target: "browser",
    format: "esm",
    splitting: true,
    naming: { entry: "capture.js", chunk: "assets/[name]-[hash].[ext]", asset: "assets/[name]-[hash].[ext]" },
    publicPath: "/native-tab-capture/",
    define: { "process.env.NODE_ENV": JSON.stringify("development") },
    tsconfig: resolve(packageRoot, "tsconfig.json"),
    files: {
      [resolve(packageRoot, "src/devtools/shared/devtoolsCssText.ts")]:
        `export default ${JSON.stringify(await css.text())};`,
    },
  });
  assert(result.success, result.logs.map(String).join("\n"));
}
