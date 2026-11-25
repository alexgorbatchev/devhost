import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stopTestProcessGroup } from "../../../test-support/stopTestProcessGroup";

// Exercise the extracted executable, its embedded assets and a private Caddy/CA without changing system trust.
export async function verifyRustReleaseRuntime(binaryPath: string): Promise<string> {
  const directoryPath = await mkdtemp(join(tmpdir(), "dhr."));
  const configDirectoryPath = join(directoryPath, "config");
  const stateDirectoryPath = join(directoryPath, "state");
  const env = {
    ...process.env,
    AGENT: "1",
    DEVHOST_CONFIG_DIR: configDirectoryPath,
    DEVHOST_STATE_DIR: stateDirectoryPath,
    DEVHOST_MANIFEST: "",
  };
  const reservations = Array.from({ length: 3 }, () =>
    Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("reserved") }),
  );
  const [adminPort, httpPort, httpsPort] = reservations.map((server) => server.port);
  let server: Bun.Subprocess | undefined;
  let sessionName: string | undefined;
  let failure: unknown;
  async function cli(args: string[]): Promise<string> {
    const child = Bun.spawn([binaryPath, ...args], {
      cwd: directoryPath,
      env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: 30_000,
      killSignal: "SIGKILL",
    });
    const [code, output, error] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    if (code !== 0) throw new Error(`Candidate ${args.join(" ")} failed (${code}): ${output}${error}`);
    return output.trim();
  }
  try {
    await mkdir(configDirectoryPath);
    await Bun.write(
      join(configDirectoryPath, "config.toml"),
      `[caddy]\nadminAddress = '127.0.0.1:${adminPort}'\nbindHost = '127.0.0.1'\nhttp = true\nhttpPort = ${httpPort}\nhttpsPort = ${httpsPort}\n`,
    );
    await Bun.write(
      join(directoryPath, "index.html"),
      "<!doctype html><title>Release probe</title><p>rust-archive-https-probe</p>",
    );
    for (const reservation of reservations) await reservation.stop(true);
    server = Bun.spawn([binaryPath, "serve", "--domain", "archive.localhost"], {
      cwd: directoryPath,
      env,
      detached: true,
      stdin: "ignore",
      stdout: Bun.file(join(directoryPath, "serve.log")),
      stderr: Bun.file(join(directoryPath, "serve-error.log")),
    });
    async function https(path: string): Promise<string> {
      const deadline = Date.now() + 30_000;
      let errorText: string = "";
      while (Date.now() < deadline) {
        const child = Bun.spawn(
          [
            "curl",
            "--silent",
            "--show-error",
            "--fail",
            "--location",
            "--max-time",
            "2",
            "--noproxy",
            "*",
            "--resolve",
            `archive.localhost:${httpsPort}:127.0.0.1`,
            "--cacert",
            join(stateDirectoryPath, "caddy/storage/pki/authorities/local/root.crt"),
            `https://archive.localhost:${httpsPort}${path}`,
          ],
          { stdout: "pipe", stderr: "pipe" },
        );
        const [code, output, error] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ]);
        if (code === 0) return output;
        errorText = error;
        await Bun.sleep(50);
      }
      throw new Error(
        `Candidate HTTPS did not become ready: ${errorText}\n${await Bun.file(join(directoryPath, "serve.log")).text()}`,
      );
    }
    if (!(await https("/")).includes("rust-archive-https-probe"))
      throw new Error("Candidate HTTPS returned the wrong document.");
    const configuration: unknown = JSON.parse(await https("/__devhost__/config.json"));
    if (
      typeof configuration !== "object" ||
      configuration === null ||
      !("statusEnabled" in configuration) ||
      typeof configuration.statusEnabled !== "boolean"
    )
      throw new Error("Candidate did not serve devtools configuration.");
    if ((await https("/__devhost__/inject.js")).length < 1000)
      throw new Error("Candidate did not serve the embedded devtools bundle.");
    const before = await cli(["stack", "list", "--sessions"]);
    sessionName = before.split("\t")[1]?.trim();
    if (!sessionName) throw new Error(`Candidate did not register its file session: ${before}`);
    await cli(["restart-all"]);
    if ((await cli(["stack", "list", "--sessions"])) === before)
      throw new Error("Candidate restart did not replace the session process.");
    if (!(await https("/")).includes("rust-archive-https-probe"))
      throw new Error("Candidate restart lost HTTPS serving.");
    await cli(["stop", "--session", sessionName]);
    sessionName = undefined;
    if ((await cli(["stack", "list", "--sessions"])) !== "")
      throw new Error("Candidate stop left a session registration.");
  } catch (error) {
    failure = error;
  }
  for (const reservation of reservations) await reservation.stop(true);
  try {
    if (sessionName) await cli(["stop", "--session", sessionName]);
    if (server) await stopTestProcessGroup(server);
    await cli(["caddy", "stop"]);
    await rm(directoryPath, { recursive: true, force: true });
  } catch (error) {
    throw new AggregateError(
      [failure, error].filter(Boolean),
      `Candidate cleanup failed; inspect preserved fixture ${directoryPath}`,
    );
  }
  if (failure) throw failure;
  return "HTTPS with fixture CA, embedded configuration, global restart and stop passed";
}
