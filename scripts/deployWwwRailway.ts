#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const projectId: string = "631518da-37bf-4d31-867f-10908bd9022c";
const environmentId: string = "cb2b2b96-f966-46cd-a594-19c1da4e8b91";
const serviceId: string = "5ce1c234-e1a8-4d0a-8ea0-79e3d413decd";
const expectedBindHost: string = "0.0.0.0";
const expectedConfigFilePath: string = "/packages/www/railway.toml";
const expectedStartCommand: string = "bun src/server.ts";
const publicUrl: string = "https://devhost.up.railway.app/";
const settingsUrl: string =
  "https://railway.com/project/631518da-37bf-4d31-867f-10908bd9022c/service/5ce1c234-e1a8-4d0a-8ea0-79e3d413decd/settings?environmentId=cb2b2b96-f966-46cd-a594-19c1da4e8b91";

const dashboardConfirmationEnvironmentVariableName: string = "RAILWAY_DASHBOARD_CONFIRMED";
const skipDeployEnvironmentVariableName: string = "DEPLOY_WWW_RAILWAY_SKIP_DEPLOY";

export async function deployWwwRailway(): Promise<void> {
  changeToRepositoryRoot();
  verifyRepositoryLayout();
  verifyRequiredCommands();
  await confirmDashboardPreflight();
  installDependencies();

  const linkResult = linkRailwayTarget();

  verifyLinkedTarget(linkResult);
  ensureRequiredServiceVariable();
  validateWwwWorkspace();

  if (readBooleanEnvironmentVariable(skipDeployEnvironmentVariableName)) {
    logStep(`Skipping deploy because ${skipDeployEnvironmentVariableName}=1`);
    return;
  }

  deployLocalCode();
  verifyLatestDeployment();
  verifyPublicEndpoint();
}

function changeToRepositoryRoot(): void {
  const currentFilePath = fileURLToPath(import.meta.url);
  const currentDirectoryPath = dirname(currentFilePath);
  const repositoryRootPath = resolve(currentDirectoryPath, "..");

  process.chdir(repositoryRootPath);
}

function verifyRepositoryLayout(): void {
  const requiredPaths: string[] = [
    "package.json",
    "bun.lock",
    "packages/devhost",
    "packages/www/package.json",
    "packages/www/railway.toml",
    "packages/www/src/server.ts",
  ];

  for (const requiredPath of requiredPaths) {
    if (!existsSync(requiredPath)) {
      throw new Error(`Missing required repository path: ${requiredPath}`);
    }
  }
}

function verifyRequiredCommands(): void {
  runInheritedCommand("bun", ["--version"]);
  runInheritedCommand("railway", ["--version"]);
  runInheritedCommand("curl", ["--version"]);
}

async function confirmDashboardPreflight(): Promise<void> {
  if (readBooleanEnvironmentVariable(dashboardConfirmationEnvironmentVariableName)) {
    return;
  }

  const confirmationMessage = [
    `Open Railway settings and verify:`,
    `- Config-as-code file = ${expectedConfigFilePath}`,
    `- Root directory is unset`,
    settingsUrl,
    `Then rerun with ${dashboardConfirmationEnvironmentVariableName}=1, or confirm interactively.`,
  ].join("\n");

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(confirmationMessage);
  }

  console.log(confirmationMessage);

  const interfaceHandle = createInterface({ input: process.stdin, output: process.stdout });
  const response = await interfaceHandle.question("Type 'yes' to continue: ");

  interfaceHandle.close();

  if (response.trim() !== "yes") {
    throw new Error("Dashboard preflight not confirmed.");
  }
}

function installDependencies(): void {
  logStep("Installing dependencies");
  runInheritedCommand("bun", ["install", "--frozen-lockfile"]);
}

function linkRailwayTarget(): unknown {
  logStep("Linking Railway target");

  return runJsonCommand("railway", [
    "link",
    "--project",
    projectId,
    "--environment",
    environmentId,
    "--service",
    serviceId,
    "--json",
  ]);
}

function verifyLinkedTarget(linkResult: unknown): void {
  logStep("Verifying linked Railway target");

  const linkedProjectId = expectStringAtPath(linkResult, ["projectId"], "linked project id");
  const linkedEnvironmentId = expectStringAtPath(linkResult, ["environmentId"], "linked environment id");
  const linkedServiceId = expectStringAtPath(linkResult, ["serviceId"], "linked service id");

  if (linkedProjectId !== projectId) {
    throw new Error(`Wrong Railway project linked: ${linkedProjectId}`);
  }

  if (linkedEnvironmentId !== environmentId) {
    throw new Error(`Wrong Railway environment linked: ${linkedEnvironmentId}`);
  }

  if (linkedServiceId !== serviceId) {
    throw new Error(`Wrong Railway service linked: ${linkedServiceId}`);
  }
}

function ensureRequiredServiceVariable(): void {
  logStep("Verifying required Railway service variable");

  const variableListResult = runJsonCommand("railway", ["variable", "list", "--json"]);
  const currentBindHost = expectStringAtPath(
    variableListResult,
    ["DEVHOST_BIND_HOST"],
    "Railway variable DEVHOST_BIND_HOST",
  );

  if (currentBindHost === expectedBindHost) {
    return;
  }

  logStep(`Setting DEVHOST_BIND_HOST=${expectedBindHost}`);
  runInheritedCommand("railway", [
    "variable",
    "set",
    `DEVHOST_BIND_HOST=${expectedBindHost}`,
    "--skip-deploys",
  ]);
}

function validateWwwWorkspace(): void {
  logStep("Validating packages/www");
  runInheritedCommand("bun", ["run", "--cwd", "packages/www", "check"]);
}

function deployLocalCode(): void {
  logStep("Deploying local code to Railway");
  runInheritedCommand("railway", ["up"]);
}

function verifyLatestDeployment(): void {
  logStep("Verifying latest deployment status");

  const serviceStatusResult = runJsonCommand("railway", ["service", "status", "--json"]);
  const deploymentStatus = expectStringAtPath(serviceStatusResult, ["status"], "latest deployment status");

  if (deploymentStatus !== "SUCCESS") {
    printLatestBuildLogs();
    throw new Error(`Latest deployment status is ${deploymentStatus}`);
  }

  const fullStatusResult = runJsonCommand("railway", ["status", "--json"]);
  const latestDeploymentPath: Array<number | string> = [
    "environments",
    "edges",
    0,
    "node",
    "serviceInstances",
    "edges",
    0,
    "node",
    "latestDeployment",
  ];
  const configFilePath = expectStringAtPath(fullStatusResult, [...latestDeploymentPath, "meta", "configFile"], "config file path");
  const startCommand = expectStringAtPath(
    fullStatusResult,
    [...latestDeploymentPath, "meta", "serviceManifest", "deploy", "startCommand"],
    "start command",
  );

  if (configFilePath !== "packages/www/railway.toml" && configFilePath !== "railway.toml") {
    printLatestBuildLogs();
    throw new Error(`Latest deployment used unexpected config file: ${configFilePath}`);
  }

  if (startCommand !== expectedStartCommand) {
    printLatestBuildLogs();
    throw new Error(`Latest deployment used unexpected start command: ${startCommand}`);
  }
}

function verifyPublicEndpoint(): void {
  logStep("Verifying public endpoint");
  runInheritedCommand("curl", ["-I", publicUrl]);
}

function printLatestBuildLogs(): void {
  logStep("Printing latest build logs");
  const result = spawnSync("railway", ["logs", "--build", "--latest", "--lines", "200"], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
  });

  if (result.stdout.length > 0) {
    process.stdout.write(result.stdout);
  }

  if (result.stderr.length > 0) {
    process.stderr.write(result.stderr);
  }
}

function runInheritedCommand(command: string, arguments_: string[]): void {
  const result = spawnSync(command, arguments_, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });

  throwOnCommandFailure(command, arguments_, result);
}

function runJsonCommand(command: string, arguments_: string[]): unknown {
  const result = spawnSync(command, arguments_, {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
  });

  throwOnCommandFailure(command, arguments_, result);

  return parseJsonOutput(`${result.stdout}\n${result.stderr}`);
}

function throwOnCommandFailure(
  command: string,
  arguments_: string[],
  result: SpawnSyncReturns<string>,
): void {
  if (result.status === 0) {
    return;
  }

  const renderedCommand = [command, ...arguments_].join(" ");
  const statusText = result.status === null ? "signal" : String(result.status);
  const stderrText = result.stderr.trim();

  throw new Error(
    stderrText.length > 0
      ? `Command failed (${statusText}): ${renderedCommand}\n${stderrText}`
      : `Command failed (${statusText}): ${renderedCommand}`,
  );
}

function parseJsonOutput(output: string): unknown {
  const objectStartIndex = output.indexOf("{");
  const arrayStartIndex = output.indexOf("[");
  const startIndex = readFirstNonNegativeIndex(objectStartIndex, arrayStartIndex);

  if (startIndex === null) {
    throw new Error(`Command did not return JSON output:\n${output}`);
  }

  return JSON.parse(output.slice(startIndex));
}

function readFirstNonNegativeIndex(...indices: number[]): number | null {
  const nonNegativeIndices = indices.filter((index: number): boolean => {
    return index >= 0;
  });

  if (nonNegativeIndices.length === 0) {
    return null;
  }

  return Math.min(...nonNegativeIndices);
}

function expectStringAtPath(value: unknown, path: Array<number | string>, label: string): string {
  const nestedValue = readPath(value, path);

  if (typeof nestedValue !== "string") {
    throw new Error(`Expected ${label} to be a string.`);
  }

  return nestedValue;
}

function readPath(value: unknown, path: Array<number | string>): unknown {
  let currentValue: unknown = value;

  for (const segment of path) {
    if (typeof segment === "number") {
      if (!Array.isArray(currentValue)) {
        return null;
      }

      currentValue = currentValue[segment];
      continue;
    }

    if (!isRecord(currentValue)) {
      return null;
    }

    currentValue = currentValue[segment];
  }

  return currentValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function logStep(message: string): void {
  console.log(`==> ${message}`);
}

function readBooleanEnvironmentVariable(name: string): boolean {
  return process.env[name] === "1";
}

if (import.meta.main) {
  deployWwwRailway().catch((error: unknown): never => {
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(error);
    }

    process.exit(1);
  });
}
