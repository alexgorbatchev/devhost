import assert from "node:assert/strict";
import { chmod, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { stopNativeReactProcess } from "./stopNativeReactProcess";
import { waitForNativeReactCondition } from "./waitForNativeReactCondition";
import type { INativeReactProject, INativeReactProvisioning, INativeReactStack } from "./types";
import type { Subprocess } from "bun";

interface INativeReactStackOptions {
  provisioning: INativeReactProvisioning;
  outputPath: string;
  fixturePorts: Record<string, number>;
  browserEndpoint: string;
  extensionId: string;
}

function allocatePort(): number {
  const listener = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(null, { status: 404 }) });
  const port = listener.port;
  listener.stop(true);
  assert(port);
  return port;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export async function startNativeReactStack(options: INativeReactStackOptions): Promise<INativeReactStack> {
  const statePath = resolve(options.outputPath, "state");
  const caddyDirectoryPath = resolve(statePath, "caddy");
  await mkdir(caddyDirectoryPath, { recursive: true });
  const caddyfilePath = resolve(caddyDirectoryPath, "Caddyfile");
  const httpPort = allocatePort();
  const httpsPort = allocatePort();
  const adminPort = allocatePort();
  const adapterPath = resolve(options.outputPath, "adapt-caddy.ts");
  await Bun.write(
    adapterPath,
    `Bun.env.DEVHOST_NATIVE_REACT_CADDYFILE = ${JSON.stringify(JSON.stringify({ path: caddyfilePath, originalPath: resolve(options.outputPath, "original-Caddyfile"), adminAddress: `127.0.0.1:${adminPort}` }))};\nawait import(${JSON.stringify(resolve(import.meta.dir, "adaptNativeReactCaddyfileMain.ts"))});\n`,
  );
  const forwarderPath = resolve(caddyDirectoryPath, "caddy");
  await Bun.write(
    forwarderPath,
    `#!/bin/sh\nset -eu\n${shellQuote(process.execPath)} ${shellQuote(adapterPath)}\nexec ${shellQuote(options.provisioning.caddyExecutablePath)} "$@"\n`,
  );
  await chmod(forwarderPath, 0o700);
  const environment = {
    ...process.env,
    AGENT: "1",
    DEVHOST_STATE_DIR: statePath,
    TMPDIR: resolve(process.cwd(), ".tmp"),
  };
  const projects: INativeReactProject[] = [];
  let isCaddyStarted: boolean = false;
  const run = async (argumentsList: string[], label: string): Promise<void> => {
    const log = Bun.file(resolve(options.outputPath, `${label}.log`));
    const command = [options.provisioning.devhostExecutablePath, ...argumentsList];
    await Bun.write(
      resolve(options.outputPath, `${label}.command.json`),
      JSON.stringify(
        { command, cwd: process.cwd(), environment: { DEVHOST_STATE_DIR: statePath, TMPDIR: environment.TMPDIR } },
        null,
        2,
      ),
    );
    const child = Bun.spawn(command, {
      cwd: process.cwd(),
      env: environment,
      stdout: log,
      stderr: log,
      timeout: 30_000,
    });
    assert.equal(await child.exited, 0, await log.text());
  };
  const stop = async (): Promise<void> => {
    const results = await Promise.allSettled(projects.map((project) => project.stop()));
    const first = projects[0];
    if (isCaddyStarted && first !== undefined) {
      const command = [options.provisioning.caddyExecutablePath, "stop", "--address", `127.0.0.1:${adminPort}`];
      await Bun.write(
        resolve(options.outputPath, "caddy-owned-stop.command.json"),
        JSON.stringify({ command }, null, 2),
      );
      const child = Bun.spawn(command, {
        env: environment,
        stdout: Bun.file(resolve(options.outputPath, "caddy-owned-stop.log")),
        stderr: "pipe",
        timeout: 30000,
      });
      assert.equal(await child.exited, 0, await new Response(child.stderr).text());
      isCaddyStarted = false;
    }
    await Bun.write(
      resolve(options.outputPath, "stack-cleanup.json"),
      JSON.stringify(
        {
          results,
          statePath,
          httpPort,
          httpsPort,
          adminPort,
          hasCaddyPid: await Bun.file(resolve(caddyDirectoryPath, "caddy.pid")).exists(),
        },
        null,
        2,
      ),
    );
    for (const result of results) assert.equal(result.status, "fulfilled", JSON.stringify(result));
  };
  try {
    for (const name of ["A", "B"]) {
      const fixturePort = options.fixturePorts[name];
      assert(fixturePort, `Real fixture listener is missing for project ${name}.`);
      const suffix = crypto.randomUUID().slice(0, 8);
      const host: string = `react-${name.toLowerCase()}-${suffix}.localhost`;
      const alias: string = `react-${name.toLowerCase()}-alias-${suffix}.localhost`;
      const projectPath = resolve(options.outputPath, `project-${name}`);
      await mkdir(projectPath, { recursive: true });
      const manifestPath = resolve(projectPath, "devhost.toml");
      await Bun.write(
        manifestPath,
        `name = "React native ${name}"\nkillZombies = false\n[worktrees]\nenabled = false\n[caddy.global]\nadminAddress = "127.0.0.1:${adminPort}"\nbindHost = "127.0.0.1"\nhttp = true\nhttpPort = ${httpPort}\nhttpsPort = ${httpsPort}\n[devtools.editor]\nenabled = false\n[devtools.minimap]\nenabled = false\n[devtools.status]\nenabled = false\n[devtools.browser]\nendpoint = ${JSON.stringify(options.browserEndpoint)}\nreactExtensionId = ${JSON.stringify(options.extensionId)}\n[services.web]\nmanaged = false\nprimary = true\nport = ${fixturePort}\nbindHost = "127.0.0.1"\nhost = [${JSON.stringify(host)}, ${JSON.stringify(alias)}]\nproxyLocalOrigin = true\n`,
      );
      let child: Subprocess | null = null;
      let generation: number = 0;
      const url: string = `http://${host}:${httpPort}/?project=${name}`;
      const project: INativeReactProject = {
        name,
        url,
        aliasUrl: `https://${alias}:${httpsPort}/project-${name.toLowerCase()}/?project=${name}`,
        manifestPath,
        start: async (): Promise<void> => {
          assert.equal(child, null, "Project is already started.");
          const command = [options.provisioning.devhostExecutablePath, "start", "--manifest", manifestPath];
          child = Bun.spawn(command, {
            cwd: process.cwd(),
            env: environment,
            stdout: Bun.file(resolve(options.outputPath, `devhost-${name}-${++generation}.stdout.log`)),
            stderr: Bun.file(resolve(options.outputPath, `devhost-${name}-${generation}.stderr.log`)),
          });
          const current = child;
          await Bun.write(
            resolve(options.outputPath, `devhost-${name}-${generation}.command.json`),
            JSON.stringify({ command, pid: current.pid, cwd: process.cwd() }, null, 2),
          );
          await waitForNativeReactCondition(`${name} actual Go configuration route`, async () => {
            assert.equal(current.exitCode, null, "Project process exited before routing.");
            try {
              return (
                (await fetch(new URL("/__devhost__/config.json", url), { signal: AbortSignal.timeout(1_000) }))
                  .status === 200
              );
            } catch {
              return false;
            }
          });
        },
        stop: async (): Promise<void> => {
          if (child === null) return;
          const current = child;
          child = null;
          const exit = await stopNativeReactProcess(current);
          await Bun.write(
            resolve(options.outputPath, `devhost-${name}-${generation}.shutdown.json`),
            JSON.stringify({ pid: current.pid, exit }),
          );
        },
      };
      projects.push(project);
    }
    const first = projects[0];
    assert(first);
    isCaddyStarted = true;
    await run(["caddy", "start", "--manifest", first.manifestPath], "caddy-start");
    await waitForNativeReactCondition("actual isolated Caddy admin before project startup", async () => {
      try {
        return (
          (await fetch(`http://127.0.0.1:${adminPort}/config/`, { signal: AbortSignal.timeout(1000) })).status === 200
        );
      } catch {
        return false;
      }
    });
    await Bun.write(
      resolve(options.outputPath, "initial-effective-caddy-config.json"),
      await (await fetch(`http://127.0.0.1:${adminPort}/config/`)).text(),
    );
    for (const project of projects) await project.start();
    await Bun.write(
      resolve(options.outputPath, "stack-ready.json"),
      JSON.stringify(
        {
          projects: projects.map((project) => ({
            name: project.name,
            url: project.url,
            aliasUrl: project.aliasUrl,
            manifestPath: project.manifestPath,
          })),
          httpPort,
          httpsPort,
          adminPort,
          adaptation:
            "Owned forwarder adds supported skip_install_trust only; Chrome ignores only the fixture certificate error. No system trust installation coverage.",
        },
        null,
        2,
      ),
    );
    await Bun.write(
      resolve(options.outputPath, "effective-caddy-config.json"),
      await (await fetch(`http://127.0.0.1:${adminPort}/config/`)).text(),
    );
    return { projects, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
