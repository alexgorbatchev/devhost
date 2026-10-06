import { version } from "react";
import { nativeReactHostVersion } from "./constants";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import tailwindPlugin from "bun-plugin-tailwind";

export async function buildNativeReactFixture(outputPath: string, repositoryRoot: string): Promise<void> {
  assert.equal(
    version,
    nativeReactHostVersion,
    "Actual fixture React runtime version differs from the native contract.",
  );
  const stylesheet = await Bun.build({
    entrypoints: [resolve(repositoryRoot, "packages/devhost-ui/src/devtools/shared/devtools.css")],
    plugins: [tailwindPlugin],
    minify: true,
    target: "browser",
  });
  assert(stylesheet.success, stylesheet.logs.map(String).join("\n"));
  const css = stylesheet.outputs.find((output) => output.path.endsWith(".css"));
  assert(css, "Actual devhost stylesheet did not build.");
  const result = await Bun.build({
    entrypoints: [resolve(import.meta.dir, "mountNativeReactFixture.tsx")],
    outdir: outputPath,
    target: "browser",
    format: "esm",
    splitting: true,
    naming: { entry: "host.js", chunk: "assets/[name]-[hash].[ext]", asset: "assets/[name]-[hash].[ext]" },
    publicPath: "/native-react-fixture/",
    define: { "process.env.NODE_ENV": JSON.stringify("development") },
    tsconfig: resolve(repositoryRoot, "packages/devhost-ui/tsconfig.json"),
    files: {
      [resolve(repositoryRoot, "packages/devhost-ui/src/devtools/shared/devtoolsCssText.ts")]:
        `export default ${JSON.stringify(await css.text())};`,
    },
  });
  assert(result.success, result.logs.map(String).join("\n"));
  await Bun.write(
    resolve(outputPath, "build-proof.json"),
    JSON.stringify(
      result.outputs.map((output) => ({ path: output.path, bytes: output.size })),
      null,
      2,
    ),
  );
}
