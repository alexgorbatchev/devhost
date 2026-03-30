import { join } from "node:path";

export type SupportedSignal = "SIGINT" | "SIGTERM" | "SIGHUP";

export const supportedSignals: SupportedSignal[] = ["SIGINT", "SIGTERM", "SIGHUP"];
export const signalExitCodes: Record<SupportedSignal, number> = {
  SIGINT: 130,
  SIGTERM: 143,
  SIGHUP: 129,
};
export const allowedBindHosts: string[] = ["127.0.0.1", "0.0.0.0", "::1", "::"];
export const startupTimeoutInMilliseconds: number = 30_000;
export const pollIntervalInMilliseconds: number = 200;
export const defaultBindHost: string = "127.0.0.1";
export const devhostDirectoryPath: string = join(import.meta.dir, "..");
export const projectPath: string = join(devhostDirectoryPath, "..");
export const caddyDirectoryPath: string = join(projectPath, "caddy");
export const routesDirectoryPath: string = join(caddyDirectoryPath, "routes");
export const registrationsDirectoryPath: string = join(routesDirectoryPath, ".registrations");
export const caddyfilePath: string = join(caddyDirectoryPath, "Caddyfile");
export const helpText: string = [
  "Usage:",
  "  bun run devhost --host hello.local.test --port 3200 -- bun run test:hello",
  "  bun run devhost",
  "  bun run devhost --manifest ./devhost.toml",
  "",
  "Options:",
  "  --host      Public hostname to register in Caddy.",
  "  --port      Local TCP port that the child process listens on.",
  "  --manifest  Explicit path to devhost.toml.",
  "",
  "Behavior:",
  "  - single-service mode keeps the existing --host / --port workflow",
  "  - manifest mode discovers devhost.toml upward from the current working directory",
  "  - routed services get devtools injection unless manifest devtools = false",
  "  - routes are removed when the child process or stack exits",
].join("\n");
