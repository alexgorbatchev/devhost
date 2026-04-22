import { fileURLToPath } from "node:url";

const devtoolsEntrypointPath: string = fileURLToPath(
  import.meta.resolve("@alexgorbatchev/devhost/src/devtools/main.ts"),
);

export async function buildDevtoolsScript(): Promise<string> {
  const buildResult = await Bun.build({
    entrypoints: [devtoolsEntrypointPath],
    format: "esm",
    minify: true,
    splitting: false,
    target: "browser",
    throw: false,
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
