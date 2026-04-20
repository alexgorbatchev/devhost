#!/usr/bin/env bun

import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const packageRootPath: string = fileURLToPath(new URL("..", import.meta.url));
const compiledBinaryPath: string = fileURLToPath(new URL("../dist/devhost", import.meta.url));
const sourceEntrypointPath: string = fileURLToPath(new URL("../cmd/devhost", import.meta.url));
const originalWorkingDirectoryPath: string = process.cwd();

const childProcess = (await hasCompiledBinary(compiledBinaryPath))
  ? Bun.spawn([compiledBinaryPath, ...process.argv.slice(2)], {
      cwd: originalWorkingDirectoryPath,
      env: process.env,
      stderr: "inherit",
      stdin: "inherit",
      stdout: "inherit",
    })
  : Bun.spawn(["go", "run", sourceEntrypointPath, ...process.argv.slice(2)], {
      cwd: packageRootPath,
      env: {
        ...process.env,
        DEVHOST_SHIM_CWD: originalWorkingDirectoryPath,
      },
      stderr: "inherit",
      stdin: "inherit",
      stdout: "inherit",
    });

process.exit(await childProcess.exited);

async function hasCompiledBinary(binaryPath: string): Promise<boolean> {
  try {
    await access(binaryPath);
    return true;
  } catch {
    return false;
  }
}
