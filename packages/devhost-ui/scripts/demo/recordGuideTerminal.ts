import assert from "node:assert/strict";
import { mkdir, symlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { allocateGuidePort } from "./allocateGuidePort";
import { assembleDemo } from "./assembleDemo";
import { cleanupDemoRuntime } from "./cleanupDemoRuntime";
import { createDemoRuntime } from "./createDemoRuntime";
import { createGuideTape } from "./createGuideTape";
import { createGuideTerminalScene } from "./createGuideTerminalScene";
import { exportClip } from "./exportClip";
import { prepareDemoCaddy } from "./prepareDemoCaddy";
import { runCommand } from "./runCommand";

export async function recordGuideTerminal(repositoryPath: string, slug: string, signal: AbortSignal): Promise<string> {
  const scene = createGuideTerminalScene(slug, await allocateGuidePort());
  const runtime = await createDemoRuntime(repositoryPath, "demo.localhost");
  console.log(`Guide ${slug}: ${runtime.directoryPath}`);
  await symlink(join(repositoryPath, "apps/devhost/bin/devhost"), join(runtime.directoryPath, "bin/devhost"));
  if (scene.isPrivateCaddy) {
    runtime.env.DEVHOST_STATE_DIR = join(runtime.directoryPath, "state");
    runtime.adminAddress = `127.0.0.1:${await allocateGuidePort()}`;
    runtime.env.DEVHOST_DEMO_ADMIN = runtime.adminAddress;
    runtime.env.DEVHOST_DEMO_HTTP_PORT = String(await allocateGuidePort());
    runtime.env.DEVHOST_DEMO_HTTPS_PORT = String(await allocateGuidePort());
    runtime.url = `https://demo.localhost:${runtime.env.DEVHOST_DEMO_HTTPS_PORT}`;
  }
  runtime.env.DEVHOST_DEMO_URL = runtime.url;
  runtime.env.DEVHOST_DEMO_CERTIFICATE = runtime.certificatePath;
  runtime.env.CURL_CA_BUNDLE = runtime.certificatePath;
  if (scene.daemonPort) runtime.env.DEVHOST_DEMO_DAEMON_PID = join(runtime.directoryPath, "daemon.pid");
  runtime.env.DEVHOST_DEMO_CONTAINER = `devhost-guide-${runtime.directoryPath.split("/").at(-1)}`;
  const manifest = scene.manifest
    .replaceAll("{{ env.DEVHOST_DEMO_HTTP_PORT }}", runtime.env.DEVHOST_DEMO_HTTP_PORT ?? "")
    .replaceAll("{{ env.DEVHOST_DEMO_HTTPS_PORT }}", runtime.env.DEVHOST_DEMO_HTTPS_PORT ?? "");
  await Bun.write(runtime.manifestPath, manifest);
  for (const [path, text] of Object.entries(scene.files ?? {})) {
    await mkdir(dirname(join(runtime.directoryPath, path)), { recursive: true });
    await Bun.write(join(runtime.directoryPath, path), text);
  }
  for (const file of [
    "serveGuideService.ts",
    "waitGuideReady.ts",
    "startGuideDaemon.ts",
    "probeGuideDaemon.ts",
    "stopGuideDaemon.ts",
  ]) {
    await Bun.write(join(runtime.directoryPath, file), Bun.file(join(import.meta.dir, "fixtures", file)));
  }
  for (const directory of ["packages/web", "packages/api"]) {
    await mkdir(join(runtime.directoryPath, directory), { recursive: true });
    await Bun.write(
      join(runtime.directoryPath, directory, "serveGuideService.ts"),
      Bun.file(join(import.meta.dir, "fixtures/serveGuideService.ts")),
    );
  }
  const options = { cwd: runtime.directoryPath, env: runtime.env, signal };
  const failures: unknown[] = [];
  let videoPath: string | undefined;
  let recordingError: unknown;
  try {
    if (scene.isPrivateCaddy) {
      const subprocess = Bun.spawn(["devhost", "caddy", "start"], {
        cwd: runtime.directoryPath,
        env: runtime.env,
        signal,
        stdout: Bun.file(join(runtime.directoryPath, "caddy-start.stdout.log")),
        stderr: Bun.file(join(runtime.directoryPath, "caddy-start.stderr.log")),
      });
      assert.equal(await subprocess.exited, 0, "The owned Caddy failed to start");
    }
    await prepareDemoCaddy(runtime, signal);
    if (scene.isDocker) {
      await runCommand(["docker", "pull", "busybox:1.37.0"], options);
      // The published server is genuine BusyBox httpd, with fixture content copied into its container.
      const container = runtime.env.DEVHOST_DEMO_CONTAINER;
      assert(container);
      await Bun.write(join(runtime.directoryPath, "index.html"), "Docker backend\n");
      assert(scene.dockerPort);
      await runCommand(
        [
          "docker",
          "create",
          "--name",
          container,
          "--publish",
          `127.0.0.1:${scene.dockerPort}:8080`,
          "--mount",
          `type=bind,source=${join(runtime.directoryPath, "index.html")},target=/www/index.html,readonly`,
          "busybox:1.37.0",
          "httpd",
          "-f",
          "-p",
          "8080",
          "-h",
          "/www",
        ],
        options,
      );
    }
    const tapePath = join(runtime.directoryPath, "guide.tape");
    await Bun.write(tapePath, createGuideTape(scene.steps));
    await runCommand(["vhs", "validate", tapePath], options);
    await runCommand(["vhs", tapePath], {
      ...options,
      timeoutMs: 240_000,
      logPath: join(runtime.directoryPath, "vhs.log"),
    });
    const responseText = await Bun.file(join(runtime.directoryPath, "response.json")).text();
    if (scene.isDocker) assert.equal(responseText, "Docker backend\n");
    else {
      const response: unknown = JSON.parse(responseText);
      assert(typeof response === "object" && response !== null && "service" in response && response.service === "web");
    }
    if (slug === "managed-caddy") {
      const api: unknown = await Bun.file(join(runtime.directoryPath, "api-response.json")).json();
      assert(typeof api === "object" && api !== null && "service" in api && api.service === "api");
    }
    if (slug === "troubleshooting") {
      const response: unknown = await Bun.file(join(runtime.directoryPath, "fixed-response.json")).json();
      assert(
        typeof response === "object" &&
          response !== null &&
          "message" in response &&
          response.message === "Configuration fixed",
      );
    }
    if (scene.isPrivateCaddy)
      assert.equal(await Bun.file(join(runtime.directoryPath, "http-response.json")).text(), responseText);
    const clip = await exportClip(
      runtime.directoryPath,
      "guide",
      join(runtime.directoryPath, "raw/guide.mp4"),
      scene.caption,
    );
    videoPath = await assembleDemo(runtime.directoryPath, [clip]);
  } catch (error) {
    recordingError = error;
    await Bun.write(
      join(runtime.directoryPath, "recording-error.log"),
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
  } finally {
    await cleanupDemoRuntime(runtime).catch((error: unknown) => {
      failures.push(error);
    });
    if (scene.daemonPort) {
      const response = await fetch(`http://127.0.0.1:${scene.daemonPort}/`, { signal: AbortSignal.timeout(500) }).catch(
        () => null,
      );
      if (response !== null) {
        await response.body?.cancel();
        failures.push(new Error("The owned demo daemon remains reachable"));
      }
    }
    if (scene.isDocker) {
      try {
        const cleanupOptions = { ...options, signal: undefined };
        const container = runtime.env.DEVHOST_DEMO_CONTAINER;
        assert(container);
        const names = await runCommand(["docker", "container", "ls", "-a", "--format", "{{.Names}}"], cleanupOptions);
        if (names.split("\n").includes(container)) await runCommand(["docker", "rm", "-f", container], cleanupOptions);
        const remaining = await runCommand(
          ["docker", "container", "ls", "-a", "--format", "{{.Names}}"],
          cleanupOptions,
        );
        assert(!remaining.split("\n").includes(container), "The owned demo container remains present");
      } catch (error) {
        failures.push(error);
      }
    }
    if (scene.isPrivateCaddy)
      await runCommand(["devhost", "caddy", "stop"], {
        ...options,
        signal: undefined,
        logPath: join(runtime.directoryPath, "caddy-stop.log"),
      }).catch((error: unknown) => {
        failures.push(error);
      });
  }
  if (failures.length > 0)
    throw new AggregateError(
      recordingError === undefined ? failures : [recordingError, ...failures],
      "Guide recording cleanup failed",
    );
  if (recordingError !== undefined) throw recordingError;
  assert(videoPath, "Guide recording produced no video");
  return videoPath;
}
