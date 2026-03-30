import { access, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { join } from "node:path";

import { startDevtoolsControlServer } from "./startDevtoolsControlServer";
import { startDocumentInjectionServer } from "./startDocumentInjectionServer";

type ISupportedSignal = "SIGINT" | "SIGTERM" | "SIGHUP";

type ICommandLineArguments = {
  host: string;
  port: number;
  command: string[];
};

type IRegistration = {
  host: string;
  port: number;
  ownerPid: number;
  createdAt: string;
};

type IStartupState =
  | {
      type: "ready";
    }
  | {
      type: "exited";
      exitCode: number;
    };

const supportedSignals: ISupportedSignal[] = ["SIGINT", "SIGTERM", "SIGHUP"];
const signalExitCodes: Record<ISupportedSignal, number> = {
  SIGINT: 130,
  SIGTERM: 143,
  SIGHUP: 129,
};
const projectPath: string = join(import.meta.dir, "..");
const caddyDirectoryPath: string = join(projectPath, "caddy");
const routesDirectoryPath: string = join(caddyDirectoryPath, "routes");
const registrationsDirectoryPath: string = join(routesDirectoryPath, ".registrations");
const caddyfilePath: string = join(caddyDirectoryPath, "Caddyfile");
const startupTimeoutInMilliseconds: number = 30_000;
const pollIntervalInMilliseconds: number = 200;
const bindHost: string = "127.0.0.1";
const helpText: string = [
  "Usage:",
  "  bun run devhost --host hello.xcv.lol --port 3200 -- bun run test:hello",
  "",
  "Options:",
  "  --host  Public hostname to register in Caddy. Must be xcv.lol or a subdomain of it.",
  "  --port  Local TCP port that the child process listens on.",
  "",
  "Behavior:",
  "  - sets HOST and PORT for the child process",
  "  - sets DEVHOST_BIND_HOST=127.0.0.1 for sane local binding",
  "  - waits for the port to open before reloading Caddy",
  "  - removes the route when the child process exits",
].join("\n");

const exitCode: number = await main();
process.exit(exitCode);

async function main(): Promise<number> {
  let childProcess: Bun.Subprocess | null = null;
  let hostReservation: IRegistration | null = null;
  let devtoolsControlServer: Awaited<ReturnType<typeof startDevtoolsControlServer>> | null = null;
  let documentInjectionServer: ReturnType<typeof startDocumentInjectionServer> | null = null;
  let receivedSignal: ISupportedSignal | null = null;
  let isRegistered: boolean = false;

  try {
    const rawArguments: string[] = process.argv.slice(2);

    if (rawArguments.includes("--help") || rawArguments.includes("-h")) {
      console.log(helpText);
      return 0;
    }

    const commandLineArguments: ICommandLineArguments = parseCommandLineArguments(rawArguments);

    await mkdir(registrationsDirectoryPath, { recursive: true });
    await ensureFileExists(caddyfilePath);
    await cleanupStaleRegistrations();

    hostReservation = createRegistration(commandLineArguments.host, commandLineArguments.port);
    await claimRegistration(hostReservation, getRegistrationPath(commandLineArguments.host));

    const childEnvironment: Record<string, string | undefined> = {
      ...process.env,
      HOST: commandLineArguments.host,
      PORT: String(commandLineArguments.port),
      DEVHOST_BIND_HOST: bindHost,
    };

    childProcess = Bun.spawn(commandLineArguments.command, {
      cwd: process.cwd(),
      env: childEnvironment,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });

    for (const signalName of supportedSignals) {
      process.on(signalName, () => {
        receivedSignal = signalName;

        if (childProcess !== null && !childProcess.killed) {
          childProcess.kill(signalName);
        }
      });
    }

    const startupState: IStartupState = await waitForChildOrPort(childProcess, commandLineArguments.port);

    if (startupState.type === "exited") {
      return startupState.exitCode;
    }

    devtoolsControlServer = await startDevtoolsControlServer();
    documentInjectionServer = startDocumentInjectionServer({
      backendHost: bindHost,
      backendPort: commandLineArguments.port,
    });

    await activateRoute(
      commandLineArguments.host,
      commandLineArguments.port,
      devtoolsControlServer.port,
      documentInjectionServer.port,
    );
    isRegistered = true;
    console.log(
      `devhost registered https://${commandLineArguments.host} -> app:${commandLineArguments.port}, control:${devtoolsControlServer.port}, document:${documentInjectionServer.port}`,
    );

    const exitCode: number = await childProcess.exited;

    if (receivedSignal !== null) {
      return signalExitCodes[receivedSignal];
    }

    return exitCode;
  } catch (error: unknown) {
    if (childProcess !== null && childProcess.exitCode === null && !childProcess.killed) {
      childProcess.kill("SIGTERM");
      await childProcess.exited;
    }

    const message: string = error instanceof Error ? error.message : String(error);
    console.error(`devhost failed: ${message}`);
    return 1;
  } finally {
    if (hostReservation !== null) {
      if (isRegistered) {
        await unregisterRoute(hostReservation.host);
        console.log(`devhost removed https://${hostReservation.host}`);
      } else {
        await removeRouteFiles(hostReservation.host);
      }
    }

    if (documentInjectionServer !== null) {
      await documentInjectionServer.stop();
    }

    if (devtoolsControlServer !== null) {
      await devtoolsControlServer.stop();
    }
  }
}

function parseCommandLineArguments(rawArguments: string[]): ICommandLineArguments {
  const separatorIndex: number = rawArguments.indexOf("--");

  if (separatorIndex === -1) {
    throw new Error("Expected '--' before the child command.");
  }

  const optionArguments: string[] = rawArguments.slice(0, separatorIndex);
  const command: string[] = rawArguments.slice(separatorIndex + 1);

  if (command.length === 0) {
    throw new Error("Expected a child command after '--'.");
  }

  const host: string = readRequiredOption(optionArguments, "--host").trim().toLowerCase();
  const portText: string = readRequiredOption(optionArguments, "--port").trim();
  const port: number = Number.parseInt(portText, 10);

  if (!isValidHost(host)) {
    throw new Error(`Host must be xcv.lol or a subdomain of it, received: ${host}`);
  }

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Port must be a valid TCP port, received: ${portText}`);
  }

  return {
    host,
    port,
    command,
  };
}

function readRequiredOption(optionArguments: string[], optionName: string): string {
  const optionIndex: number = optionArguments.indexOf(optionName);

  if (optionIndex === -1) {
    throw new Error(`Missing required option: ${optionName}`);
  }

  const optionValue: string | undefined = optionArguments[optionIndex + 1];

  if (optionValue === undefined || optionValue.startsWith("--")) {
    throw new Error(`Missing value for ${optionName}`);
  }

  return optionValue;
}

function isValidHost(host: string): boolean {
  const hostPattern: RegExp = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

  if (!hostPattern.test(host)) {
    return false;
  }

  return host === "xcv.lol" || host.endsWith(".xcv.lol");
}

async function ensureFileExists(filePath: string): Promise<void> {
  try {
    await access(filePath);
  } catch {
    throw new Error(`Required file is missing: ${filePath}`);
  }
}

async function waitForChildOrPort(childProcess: Bun.Subprocess, port: number): Promise<IStartupState> {
  const deadline: number = Date.now() + startupTimeoutInMilliseconds;

  while (Date.now() < deadline) {
    const isPortOpen: boolean = await canConnectToPort(port);

    if (isPortOpen) {
      return { type: "ready" };
    }

    if (childProcess.exitCode !== null) {
      const exitCode: number = await childProcess.exited;
      return {
        type: "exited",
        exitCode,
      };
    }

    await Bun.sleep(pollIntervalInMilliseconds);
  }

  if (!childProcess.killed) {
    childProcess.kill("SIGTERM");
  }

  await childProcess.exited;
  throw new Error(
    `Command did not start listening on ${bindHost}:${port} within ${startupTimeoutInMilliseconds}ms.`,
  );
}

async function canConnectToPort(port: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = createConnection({
      host: bindHost,
      port,
    });

    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });

    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });

    socket.setTimeout(pollIntervalInMilliseconds, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function cleanupStaleRegistrations(): Promise<void> {
  const registrationFileNames: string[] = await readdir(registrationsDirectoryPath);

  for (const registrationFileName of registrationFileNames) {
    if (!registrationFileName.endsWith(".json")) {
      continue;
    }

    const registrationPath: string = join(registrationsDirectoryPath, registrationFileName);
    const registrationText: string = await readFile(registrationPath, "utf8");
    const registration: IRegistration = parseRegistration(registrationText);

    if (isProcessAlive(registration.ownerPid)) {
      continue;
    }

    await removeRouteFiles(registration.host);
  }
}

function isProcessAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

function createRegistration(host: string, port: number): IRegistration {
  return {
    host,
    port,
    ownerPid: process.pid,
    createdAt: new Date().toISOString(),
  };
}

async function activateRoute(
  host: string,
  appPort: number,
  devtoolsControlPort: number,
  documentInjectionPort: number,
): Promise<void> {
  const routePath: string = getRoutePath(host);

  try {
    await writeFile(routePath, renderRouteSnippet(host, appPort, devtoolsControlPort, documentInjectionPort), "utf8");
    reloadCaddy();
  } catch (error) {
    await removeRouteFiles(host);
    throw error;
  }
}

async function unregisterRoute(host: string): Promise<void> {
  const registrationPath: string = getRegistrationPath(host);

  try {
    const registrationText: string = await readFile(registrationPath, "utf8");
    const registration: IRegistration = parseRegistration(registrationText);

    if (registration.ownerPid !== process.pid) {
      return;
    }
  } catch {
    return;
  }

  await removeRouteFiles(host);
  reloadCaddy();
}

async function claimRegistration(registration: IRegistration, registrationPath: string): Promise<void> {
  try {
    await writeFile(registrationPath, JSON.stringify(registration, null, 2), {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (error: unknown) {
    if (!isErrorWithCode(error) || error.code !== "EEXIST") {
      throw error;
    }

    const existingText: string = await readFile(registrationPath, "utf8");
    const existingRegistration: IRegistration = parseRegistration(existingText);

    if (isProcessAlive(existingRegistration.ownerPid)) {
      throw new Error(
        `${registration.host} is already claimed by PID ${existingRegistration.ownerPid} on port ${existingRegistration.port}.`,
      );
    }

    await removeRouteFiles(existingRegistration.host);
    await writeFile(registrationPath, JSON.stringify(registration, null, 2), {
      encoding: "utf8",
      flag: "wx",
    });
  }
}

function isErrorWithCode(error: unknown): error is Error & { code: string } {
  return error instanceof Error && typeof Reflect.get(error, "code") === "string";
}

function parseRegistration(registrationText: string): IRegistration {
  const parsedValue: unknown = JSON.parse(registrationText);

  if (!isRegistration(parsedValue)) {
    throw new Error("Registration file is malformed.");
  }

  return parsedValue;
}

function isRegistration(value: unknown): value is IRegistration {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "host") === "string" &&
    typeof Reflect.get(value, "port") === "number" &&
    typeof Reflect.get(value, "ownerPid") === "number" &&
    typeof Reflect.get(value, "createdAt") === "string"
  );
}

function reloadCaddy(): void {
  const result = Bun.spawnSync(["caddy", "reload", "--config", caddyfilePath, "--adapter", "caddyfile"], {
    cwd: caddyDirectoryPath,
    stdout: "inherit",
    stderr: "inherit",
  });

  if (!result.success) {
    throw new Error("Caddy reload failed. Is Caddy already running?");
  }
}

function renderRouteSnippet(
  host: string,
  appPort: number,
  devtoolsControlPort: number,
  documentInjectionPort: number,
): string {
  return [
    `${host} {`,
    "    tls internal",
    "",
    "    @devhost_control path /__devhost__/*",
    "    handle @devhost_control {",
    `        reverse_proxy ${bindHost}:${devtoolsControlPort}`,
    "    }",
    "",
    "    @devhost_document header Sec-Fetch-Dest document",
    "    handle @devhost_document {",
    `        reverse_proxy ${bindHost}:${documentInjectionPort}`,
    "    }",
    "",
    "    handle {",
    `        reverse_proxy ${bindHost}:${appPort}`,
    "    }",
    "}",
    "",
  ].join("\n");
}

function getRegistrationPath(host: string): string {
  return join(registrationsDirectoryPath, `${host}.json`);
}

function getRoutePath(host: string): string {
  return join(routesDirectoryPath, `${host}.caddy`);
}

async function removeRouteFiles(host: string): Promise<void> {
  await rm(getRegistrationPath(host), { force: true });
  await rm(getRoutePath(host), { force: true });
}
