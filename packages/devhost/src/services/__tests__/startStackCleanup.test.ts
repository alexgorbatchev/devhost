import assert from "node:assert";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

const temporaryDirectoryPaths: string[] = [];
const packageRootPath: string = resolve(import.meta.dir, "..", "..", "..");

type ProcessOutput = Buffer | Uint8Array | undefined;

interface IStartStackCleanupFailurePayload {
  errorMessage: string | null;
  hostClaimFileNames: string[];
  portClaimFileNames: string[];
  registrationFileNames: string[];
  routeFileNames: string[];
}

interface IStartStackAutoPortRetryPayload {
  assignedPort: string | null;
  errorMessage: string | null;
  exitCode: number | null;
  finalPort: number | null;
  infoLines: string[];
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectoryPaths.map(async (temporaryDirectoryPath: string): Promise<void> => {
      await rm(temporaryDirectoryPath, { force: true, recursive: true });
    }),
  );
  temporaryDirectoryPaths.length = 0;
});

describe("startStack cleanup", () => {
  test("releases hostname and fixed-port claims after a startup failure", async () => {
    const temporaryDirectoryPath: string = await mkdtemp(join(tmpdir(), "devhost-start-stack-cleanup-"));
    const runnerPath: string = join(temporaryDirectoryPath, "startStackCleanupRunner.ts");
    const adminPort: number = 23111;
    const fixedPort: number = 39876;

    temporaryDirectoryPaths.push(temporaryDirectoryPath);
    await writeFile(
      runnerPath,
      [
        `import { readdir } from "node:fs/promises";`,
        `import { createManagedCaddyPaths } from ${JSON.stringify(join(packageRootPath, "src/caddy/caddyPaths.ts"))};`,
        `import { createDefaultDevhostAgent } from ${JSON.stringify(join(packageRootPath, "src/agents/createDefaultDevhostAgent.ts"))};`,
        `import { createLogger } from ${JSON.stringify(join(packageRootPath, "src/utils/createLogger.ts"))};`,
        `import { startStack } from ${JSON.stringify(join(packageRootPath, "src/services/startStack.ts"))};`,
        `const adminServer = Bun.serve({`,
        `  hostname: "127.0.0.1",`,
        `  port: ${adminPort},`,
        `  fetch(): Response {`,
        `    return new Response("{}", { status: 200 });`,
        `  },`,
        `});`,
        `const logger = createLogger({ errorSink: () => undefined, infoSink: () => undefined });`,
        `const paths = createManagedCaddyPaths(process.env.DEVHOST_STATE_DIR);`,
        `let errorMessage = null;`,
        `try {`,
        `  await startStack(`,
        `    {`,
        `      agent: createDefaultDevhostAgent(),`,
        `      devtools: {`,
        `        editor: { enabled: false, ide: "vscode" },`,
        `        externalToolbars: { enabled: false },`,
        `        minimap: { enabled: false, position: "right" },`,
        `        status: { enabled: false, position: "bottom-right" },`,
        `      },`,
        `      manifestDirectoryPath: ${JSON.stringify(packageRootPath)},`,
        `      manifestPath: ${JSON.stringify(join(packageRootPath, "devhost.toml"))},`,
        `      name: "cleanup-stack",`,
        `      primaryService: "web",`,
        `      services: {`,
        `        web: {`,
        `          bindHost: "127.0.0.1",`,
        `          command: ["/usr/bin/false"],`,
        `          cwd: ${JSON.stringify(packageRootPath)},`,
        `          dependsOn: [],`,
        `          env: {},`,
        `          health: { host: "127.0.0.1", interval: 50, kind: "tcp", port: ${fixedPort}, retries: 0, timeout: 200 },`,
        `          host: "cleanup.localhost",`,
        `          name: "web",`,
        `          path: "/",`,
        `          port: ${fixedPort},`,
        `          portSource: "fixed",`,
        `        },`,
        `      },`,
        `    },`,
        `    ["web"],`,
        `    logger,`,
        `  );`,
        `} catch (error) {`,
        `  errorMessage = error instanceof Error ? error.message : String(error);`,
        `}`,
        `const hostClaimFileNames = await readdir(paths.hostClaimsDirectoryPath);`,
        `const portClaimFileNames = await readdir(paths.portClaimsDirectoryPath);`,
        `const registrationFileNames = await readdir(paths.registrationsDirectoryPath);`,
        `const routeFileNames = (await readdir(paths.routesDirectoryPath)).filter((entry) => entry.endsWith(".caddy"));`,
        `await adminServer.stop(true);`,
        `console.log(JSON.stringify({ errorMessage, hostClaimFileNames, portClaimFileNames, registrationFileNames, routeFileNames }));`,
      ].join("\n"),
      "utf8",
    );

    const result = Bun.spawnSync(["bun", runnerPath], {
      cwd: packageRootPath,
      env: {
        ...process.env,
        DEVHOST_CADDY_ADMIN_ADDRESS: `127.0.0.1:${adminPort}`,
        DEVHOST_STATE_DIR: temporaryDirectoryPath,
      },
      stderr: "pipe",
      stdout: "pipe",
    });

    expect(result.exitCode).toBe(0);

    const stdoutText: string = decodeProcessOutput(result.stdout);
    const stderrText: string = decodeProcessOutput(result.stderr);

    expect(stderrText).toBe("");

    const payload = parseCleanupFailurePayload(stdoutText);

    expect(payload.errorMessage).toBe("Service web exited before passing its health check with code 1.");
    expect(payload.hostClaimFileNames).toEqual([]);
    expect(payload.portClaimFileNames).toEqual([]);
    expect(payload.registrationFileNames).toEqual([]);
    expect(payload.routeFileNames).toEqual([]);
  });

  test("retries auto-port startup after bind-collision stderr output from a failed attempt", async () => {
    const temporaryDirectoryPath: string = await mkdtemp(join(tmpdir(), "devhost-start-stack-retry-"));
    const runnerPath: string = join(temporaryDirectoryPath, "startStackAutoPortRetryRunner.ts");
    const servicePath: string = join(temporaryDirectoryPath, "autoPortRetryService.ts");
    const tracePath: string = join(temporaryDirectoryPath, "assigned-port.txt");
    const adminPort: number = 23112;
    const initialPort: number = 39877;

    temporaryDirectoryPaths.push(temporaryDirectoryPath);
    await writeFile(
      servicePath,
      [
        `import { writeFile } from "node:fs/promises";`,
        `const port = Number(process.env.PORT);`,
        `const initialPort = Number(process.env.INITIAL_PORT);`,
        `const tracePath = process.env.PORT_TRACE_PATH;`,
        `if (tracePath === undefined) {`,
        `  throw new Error("PORT_TRACE_PATH is required.");`,
        `}`,
        `if (port === initialPort) {`,
        `  console.error(\`listen EADDRINUSE: address already in use 127.0.0.1:\${port}\`);`,
        `  process.exit(1);`,
        `}`,
        `await writeFile(tracePath, String(port), "utf8");`,
        `const server = Bun.serve({`,
        `  hostname: "127.0.0.1",`,
        `  port,`,
        `  fetch(): Response {`,
        `    return new Response("ok");`,
        `  },`,
        `});`,
        `setTimeout(async () => {`,
        `  await server.stop(true);`,
        `  process.exit(0);`,
        `}, 250);`,
        `await new Promise(() => undefined);`,
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      runnerPath,
      [
        `import { readFile } from "node:fs/promises";`,
        `import { createDefaultDevhostAgent } from ${JSON.stringify(join(packageRootPath, "src/agents/createDefaultDevhostAgent.ts"))};`,
        `import { createLogger } from ${JSON.stringify(join(packageRootPath, "src/utils/createLogger.ts"))};`,
        `import { startStack } from ${JSON.stringify(join(packageRootPath, "src/services/startStack.ts"))};`,
        `const infoLines = [];`,
        `const logger = createLogger({`,
        `  errorSink: () => undefined,`,
        `  infoSink: (message) => {`,
        `    infoLines.push(message);`,
        `  },`,
        `});`,
        `const adminServer = Bun.serve({`,
        `  hostname: "127.0.0.1",`,
        `  port: ${adminPort},`,
        `  fetch(): Response {`,
        `    return new Response("{}", { status: 200 });`,
        `  },`,
        `});`,
        `const initialPort = Number(process.env.INITIAL_PORT);`,
        `const tracePath = process.env.PORT_TRACE_PATH;`,
        `if (tracePath === undefined) {`,
        `  throw new Error("PORT_TRACE_PATH is required.");`,
        `}`,
        `const manifest = {`,
        `  agent: createDefaultDevhostAgent(),`,
        `  devtools: {`,
        `    editor: { enabled: false, ide: "vscode" },`,
        `    externalToolbars: { enabled: false },`,
        `    minimap: { enabled: false, position: "right" },`,
        `    status: { enabled: false, position: "bottom-right" },`,
        `  },`,
        `  manifestDirectoryPath: ${JSON.stringify(packageRootPath)},`,
        `  manifestPath: ${JSON.stringify(join(packageRootPath, "devhost.toml"))},`,
        `  name: "retry-stack",`,
        `  primaryService: "web",`,
        `  services: {`,
        `    web: {`,
        `      bindHost: "127.0.0.1",`,
        `      command: ["bun", ${JSON.stringify(servicePath)}],`,
        `      cwd: ${JSON.stringify(packageRootPath)},`,
        `      dependsOn: [],`,
        `      env: { INITIAL_PORT: String(initialPort), PORT_TRACE_PATH: tracePath },`,
        `      health: { host: "127.0.0.1", interval: 50, kind: "tcp", port: initialPort, retries: 0, timeout: 5_000 },`,
        `      host: null,`,
        `      name: "web",`,
        `      path: null,`,
        `      port: initialPort,`,
        `      portSource: "auto",`,
        `    },`,
        `  },`,
        `};`,
        `let errorMessage = null;`,
        `let exitCode = null;`,
        `try {`,
        `  exitCode = await startStack(manifest, ["web"], logger);`,
        `} catch (error) {`,
        `  errorMessage = error instanceof Error ? error.message : String(error);`,
        `}`,
        `const assignedPort = await readFile(tracePath, "utf8").then((value) => value.trim()).catch(() => null);`,
        `await adminServer.stop(true);`,
        `console.log(JSON.stringify({ assignedPort, errorMessage, exitCode, finalPort: manifest.services.web.port, infoLines }));`,
      ].join("\n"),
      "utf8",
    );

    const result = Bun.spawnSync(["bun", runnerPath], {
      cwd: packageRootPath,
      env: {
        ...process.env,
        DEVHOST_CADDY_ADMIN_ADDRESS: `127.0.0.1:${adminPort}`,
        DEVHOST_STATE_DIR: temporaryDirectoryPath,
        INITIAL_PORT: String(initialPort),
        PORT_TRACE_PATH: tracePath,
      },
      stderr: "pipe",
      stdout: "pipe",
    });

    expect(result.exitCode).toBe(0);

    const stdoutText: string = decodeProcessOutput(result.stdout);
    const stderrText: string = decodeProcessOutput(result.stderr);

    expect(stderrText).toBe(`[web] listen EADDRINUSE: address already in use 127.0.0.1:${initialPort}`);

    const payload = parseAutoPortRetryPayload(stdoutText);

    expect(payload.assignedPort).toBe(String(payload.finalPort));
    expect(payload.errorMessage).toBe(null);
    expect(payload.exitCode).toBe(0);
    expect(payload.finalPort).not.toBe(initialPort);
    expect(payload.infoLines[0]).toBe("[devhost] retrying web with a new auto port after a bind collision.");
    expect(payload.infoLines[1]).toBe(`[devhost] primary web -> http://127.0.0.1:${payload.finalPort}`);
    expect(payload.infoLines).toHaveLength(2);
  });
});

function decodeProcessOutput(output: ProcessOutput): string {
  return new TextDecoder().decode(output ?? new Uint8Array()).trim();
}

function parseCleanupFailurePayload(stdoutText: string): IStartStackCleanupFailurePayload {
  const payload: unknown = JSON.parse(stdoutText);

  assert(isStartStackCleanupFailurePayload(payload), "Unexpected cleanup failure payload.");

  return payload;
}

function parseAutoPortRetryPayload(stdoutText: string): IStartStackAutoPortRetryPayload {
  const payload: unknown = JSON.parse(stdoutText);

  assert(isStartStackAutoPortRetryPayload(payload), "Unexpected auto-port retry payload.");

  return payload;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === "number";
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item: unknown): boolean => typeof item === "string");
}

function isStartStackCleanupFailurePayload(value: unknown): value is IStartStackCleanupFailurePayload {
  return (
    isRecord(value) &&
    isNullableString(value.errorMessage) &&
    isStringArray(value.hostClaimFileNames) &&
    isStringArray(value.portClaimFileNames) &&
    isStringArray(value.registrationFileNames) &&
    isStringArray(value.routeFileNames)
  );
}

function isStartStackAutoPortRetryPayload(value: unknown): value is IStartStackAutoPortRetryPayload {
  return (
    isRecord(value) &&
    isNullableString(value.assignedPort) &&
    isNullableString(value.errorMessage) &&
    isNullableNumber(value.exitCode) &&
    isNullableNumber(value.finalPort) &&
    isStringArray(value.infoLines)
  );
}
