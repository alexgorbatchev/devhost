#!/usr/bin/env bun

import { cp, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import tailwindPlugin from "bun-plugin-tailwind";

const workspaceRootPath: string = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRootPath: string = path.join(workspaceRootPath, "dist");
const publicSourcePath: string = path.join(workspaceRootPath, "public");
const publicOutputPath: string = path.join(distRootPath, "public");
const serverEntrypointPath: string = path.join(workspaceRootPath, "src/productionServer.ts");
const serverOutputPath: string = path.join(distRootPath, "server.js");
const serverTemporaryOutputPath: string = path.join(distRootPath, "src/productionServer.js");
const staticEntrypointPath: string = path.join(workspaceRootPath, "index.html");
const staticOutputPath: string = path.join(distRootPath, "static");
const tsconfigPath: string = path.join(workspaceRootPath, "tsconfig.json");
const productionDefine: Record<string, string> = {
  "process.env.NODE_ENV": '"production"',
};

await rm(distRootPath, { force: true, recursive: true });
await mkdir(staticOutputPath, { recursive: true });

const staticBuildResult = await Bun.build({
  define: productionDefine,
  entrypoints: [staticEntrypointPath],
  minify: true,
  outdir: staticOutputPath,
  plugins: [tailwindPlugin],
  root: workspaceRootPath,
  target: "browser",
  throw: false,
  tsconfig: tsconfigPath,
});

throwOnBuildFailure(staticBuildResult, "static app");

const serverBuildResult = await Bun.build({
  define: productionDefine,
  entrypoints: [serverEntrypointPath],
  minify: true,
  outdir: distRootPath,
  root: workspaceRootPath,
  target: "bun",
  throw: false,
  tsconfig: tsconfigPath,
});

throwOnBuildFailure(serverBuildResult, "production server");
await rename(serverTemporaryOutputPath, serverOutputPath);
await rm(path.join(distRootPath, "src"), { force: true, recursive: true });
await cp(publicSourcePath, publicOutputPath, { recursive: true });

function throwOnBuildFailure(buildResult: Bun.BuildOutput, targetName: string): void {
  if (buildResult.success) {
    return;
  }

  const logMessages: string = buildResult.logs.map((log) => log.message).join("\n");

  throw new Error(`Failed to build ${targetName}:\n${logMessages}`);
}
