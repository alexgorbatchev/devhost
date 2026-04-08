#!/usr/bin/env bun

import { existsSync, readFileSync } from "node:fs";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectId: string = "631518da-37bf-4d31-867f-10908bd9022c";
const environmentId: string = "cb2b2b96-f966-46cd-a594-19c1da4e8b91";
const serviceId: string = "5ce1c234-e1a8-4d0a-8ea0-79e3d413decd";
const expectedBindHost: string = "0.0.0.0";
const expectedStartCommand: string = "bun packages/www/src/server.ts";
const publicUrl: string = "https://devhost.up.railway.app/";
const railwayGraphqlUrl: string = "https://backboard.railway.com/graphql/v2";
const skipDeployEnvironmentVariableName: string = "DEPLOY_WWW_RAILWAY_SKIP_DEPLOY";
const railwayApiTokenEnvironmentVariableNames: string[] = ["RAILWAY_API_TOKEN", "RAILWAY_TOKEN"];

interface IRailwayConfigFile {
  user?: {
    accessToken?: unknown;
  };
}

interface IServiceInstanceSettings {
  rootDirectory: string | null;
  startCommand: string | null;
}

export async function deployWwwRailway(): Promise<void> {
  changeToRepositoryRoot();
  verifyRepositoryLayout();
  verifyRequiredCommands();
  installDependencies();

  const linkResult = linkRailwayTarget();

  verifyLinkedTarget(linkResult);
  ensureRequiredServiceSettings();
  ensureRequiredServiceVariable();
  validateWwwWorkspace();

  if (readBooleanEnvironmentVariable(skipDeployEnvironmentVariableName)) {
    logStep(`Skipping deploy because ${skipDeployEnvironmentVariableName}=1`);
    return;
  }

  deployLocalCode();
  await verifyLatestDeployment();
  await verifyPublicEndpoint();
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

function ensureRequiredServiceSettings(): void {
  logStep("Verifying required Railway service settings");

  const serviceInstanceSettings = queryServiceInstanceSettings();

  if (
    serviceInstanceSettings.startCommand === expectedStartCommand &&
    serviceInstanceSettings.rootDirectory === null
  ) {
    return;
  }

  logStep("Updating Railway service settings");

  runRailwayGraphqlMutation(
    "mutation($serviceId:String!,$environmentId:String!,$input:ServiceInstanceUpdateInput!){serviceInstanceUpdate(serviceId:$serviceId,environmentId:$environmentId,input:$input)}",
    {
      environmentId,
      input: {
        rootDirectory: null,
        startCommand: expectedStartCommand,
      },
      serviceId,
    },
  );

  const updatedServiceInstanceSettings = queryServiceInstanceSettings();

  if (updatedServiceInstanceSettings.rootDirectory !== null) {
    throw new Error("Railway service rootDirectory is still set after attempted update.");
  }

  if (updatedServiceInstanceSettings.startCommand !== expectedStartCommand) {
    throw new Error(`Railway service startCommand is still ${String(updatedServiceInstanceSettings.startCommand)} after attempted update.`);
  }
}

function ensureRequiredServiceVariable(): void {
  logStep("Verifying required Railway service variable");

  const variableListResult = runJsonCommand("railway", ["variable", "list", "--json"]);
  const currentBindHost = readOptionalStringAtPath(variableListResult, ["DEVHOST_BIND_HOST"]);

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

async function verifyLatestDeployment(): Promise<void> {
  logStep("Verifying latest deployment status");

  const terminalDeploymentStatus = await waitForTerminalDeploymentStatus();

  if (terminalDeploymentStatus !== "SUCCESS") {
    printLatestBuildLogs();
    throw new Error(`Latest deployment status is ${terminalDeploymentStatus}`);
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
  const startCommand = expectStringAtPath(
    fullStatusResult,
    [...latestDeploymentPath, "meta", "serviceManifest", "deploy", "startCommand"],
    "start command",
  );

  if (startCommand !== expectedStartCommand) {
    printLatestBuildLogs();
    throw new Error(`Latest deployment used unexpected start command: ${startCommand}`);
  }
}

async function waitForTerminalDeploymentStatus(): Promise<string> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const serviceStatusResult = runJsonCommand("railway", ["service", "status", "--json"]);
    const deploymentStatus = expectStringAtPath(serviceStatusResult, ["status"], "latest deployment status");

    if (isTerminalDeploymentStatus(deploymentStatus)) {
      return deploymentStatus;
    }

    await waitMilliseconds(5_000);
  }

  throw new Error("Timed out while waiting for the latest Railway deployment to reach a terminal state.");
}

async function verifyPublicEndpoint(): Promise<void> {
  logStep("Verifying public endpoint");

  for (let attempt = 0; attempt < 24; attempt += 1) {
    const responseResult = spawnSync("curl", ["-fsSIL", publicUrl], {
      cwd: process.cwd(),
      env: process.env,
      encoding: "utf8",
    });

    if (responseResult.status === 0) {
      if (responseResult.stdout.length > 0) {
        process.stdout.write(responseResult.stdout);
      }

      return;
    }

    await waitMilliseconds(5_000);
  }

  printLatestDeploymentLogs();
  throw new Error(`Public endpoint did not become healthy: ${publicUrl}`);
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

function printLatestDeploymentLogs(): void {
  logStep("Printing latest deployment logs");
  const result = spawnSync("railway", ["logs", "--deployment", "--latest", "--lines", "200"], {
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

function queryServiceInstanceSettings(): IServiceInstanceSettings {
  const result = runRailwayGraphqlQuery(
    "query($serviceId:String!,$environmentId:String!){serviceInstance(serviceId:$serviceId,environmentId:$environmentId){startCommand rootDirectory}}",
    { environmentId, serviceId },
  );

  return {
    rootDirectory: readNullableStringAtPath(result, ["data", "serviceInstance", "rootDirectory"]),
    startCommand: readNullableStringAtPath(result, ["data", "serviceInstance", "startCommand"]),
  };
}

function runRailwayGraphqlQuery(query: string, variables: Record<string, unknown>): unknown {
  return runRailwayGraphqlRequest(query, variables);
}

function runRailwayGraphqlMutation(query: string, variables: Record<string, unknown>): unknown {
  return runRailwayGraphqlRequest(query, variables);
}

function runRailwayGraphqlRequest(query: string, variables: Record<string, unknown>): unknown {
  const railwayAccessToken = resolveRailwayAccessToken();

  return fetchJson(railwayGraphqlUrl, {
    body: JSON.stringify({ query, variables }),
    headers: {
      Authorization: `Bearer ${railwayAccessToken}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
}

function resolveRailwayAccessToken(): string {
  for (const environmentVariableName of railwayApiTokenEnvironmentVariableNames) {
    const environmentVariableValue = process.env[environmentVariableName];

    if (typeof environmentVariableValue === "string" && environmentVariableValue.length > 0) {
      return environmentVariableValue;
    }
  }

  const homeDirectoryPath = process.env.HOME;

  if (typeof homeDirectoryPath !== "string" || homeDirectoryPath.length === 0) {
    throw new Error("Missing HOME; cannot resolve Railway access token from ~/.railway/config.json.");
  }

  const railwayConfigFilePath = resolve(homeDirectoryPath, ".railway/config.json");

  if (!existsSync(railwayConfigFilePath)) {
    throw new Error("Missing Railway auth config. Run `railway login` or set RAILWAY_API_TOKEN.");
  }

  const railwayConfigFileValue: unknown = JSON.parse(readFileSync(railwayConfigFilePath, "utf8"));

  if (!isRailwayConfigFile(railwayConfigFileValue)) {
    throw new Error("Unexpected Railway auth config shape in ~/.railway/config.json.");
  }

  if (typeof railwayConfigFileValue.user?.accessToken !== "string" || railwayConfigFileValue.user.accessToken.length === 0) {
    throw new Error("Missing Railway access token. Run `railway login` or set RAILWAY_API_TOKEN.");
  }

  return railwayConfigFileValue.user.accessToken;
}

function fetchJson(url: string, requestInit: RequestInit): unknown {
  const responseResult = spawnSync("curl", [
    "-fsSL",
    "-X",
    requestInit.method ?? "GET",
    url,
    "-H",
    `Authorization: ${String(requestInit.headers instanceof Headers ? requestInit.headers.get("Authorization") ?? "" : (requestInit.headers as Record<string, string>).Authorization ?? "")}`,
    "-H",
    `Content-Type: ${String(requestInit.headers instanceof Headers ? requestInit.headers.get("Content-Type") ?? "application/json" : (requestInit.headers as Record<string, string>)["Content-Type"] ?? "application/json")}`,
    "--data",
    typeof requestInit.body === "string" ? requestInit.body : "",
  ], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
  });

  throwOnCommandFailure("curl", [], responseResult);

  return JSON.parse(responseResult.stdout);
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

function readNullableStringAtPath(value: unknown, path: Array<number | string>): string | null {
  const nestedValue = readPath(value, path);

  if (nestedValue === null || nestedValue === undefined) {
    return null;
  }

  if (typeof nestedValue !== "string") {
    throw new Error("Expected nested value to be a string or null.");
  }

  return nestedValue;
}

function readOptionalStringAtPath(value: unknown, path: Array<number | string>): string | null {
  const nestedValue = readPath(value, path);

  if (nestedValue === null || nestedValue === undefined) {
    return null;
  }

  if (typeof nestedValue !== "string") {
    throw new Error("Expected nested value to be a string or null.");
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

function isRailwayConfigFile(value: unknown): value is IRailwayConfigFile {
  return isRecord(value);
}

function logStep(message: string): void {
  console.log(`==> ${message}`);
}

function readBooleanEnvironmentVariable(name: string): boolean {
  return process.env[name] === "1";
}

function isTerminalDeploymentStatus(deploymentStatus: string): boolean {
  return deploymentStatus === "SUCCESS" || deploymentStatus === "FAILED" || deploymentStatus === "CRASHED";
}

function waitMilliseconds(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise: () => void): void => {
    setTimeout(resolvePromise, milliseconds);
  });
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
