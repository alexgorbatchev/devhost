import { fileURLToPath } from "node:url";

import prebuiltDevtoolsScriptFilePath from "./devtoolsScript.generated.txt" with { type: "file" };

const devtoolsEntrypointPath: string = fileURLToPath(new URL("../devtools/main.ts", import.meta.url));
const tsconfigPath: string = fileURLToPath(new URL("../../tsconfig.json", import.meta.url));

export async function buildDevtoolsScript(): Promise<string> {
  if (shouldUsePrebuiltDevtoolsScript(devtoolsEntrypointPath, tsconfigPath)) {
    return await Bun.file(prebuiltDevtoolsScriptFilePath).text();
  }

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

  return await scriptOutput.text();
}

function shouldUsePrebuiltDevtoolsScript(entrypointPath: string, projectTsconfigPath: string): boolean {
  return isEmbeddedBunFileSystemPath(entrypointPath) || isEmbeddedBunFileSystemPath(projectTsconfigPath);
}

function isEmbeddedBunFileSystemPath(path: string): boolean {
  return path.includes("$bunfs");
}
