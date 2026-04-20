import { dedentString } from "@alexgorbatchev/dedent-string";

import { caddyAdminApiUrl } from "../caddy/caddyPaths";

export { caddyAdminApiUrl };

export const supportedSignals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
export const signalExitCodes: Readonly<Record<(typeof supportedSignals)[number], number>> = {
  SIGINT: 130,
  SIGTERM: 143,
  SIGHUP: 129,
};
export const allowedBindHosts: string[] = ["127.0.0.1", "0.0.0.0", "::1", "::"];
export const startupTimeoutInMilliseconds: number = 30_000;
export const pollIntervalInMilliseconds: number = 200;
export const defaultBindHost: string = "127.0.0.1";
export const caddyAdminTimeoutInMilliseconds: number = 1_000;
export const helpText: string = dedentString(`
  Usage:
    devhost
    devhost --manifest ./devhost.toml
    devhost caddy start
    devhost caddy stop
    devhost caddy trust
    devhost caddy download
    devhost caddy privileged-ports
    devhost caddy print-root-cert
    devhost caddy trust-remote <ssh-target>

  Options:
    --manifest  Explicit path to devhost.toml.

  Behavior:
    - manifest mode discovers devhost.toml upward from the current working directory
    - routed services get devtools injection unless manifest devtools = false
    - \`devhost caddy start\` generates a managed Caddyfile under DEVHOST_STATE_DIR or ~/.local/state/devhost
    - managed Caddy may prompt for your password when installing its local CA into the system trust store
    - \`devhost caddy trust-remote\` SSHes to another host, reads that host's managed Caddy root certificate, and installs it into the local macOS system keychain
    - on Linux, \`devhost caddy privileged-ports\` grants the managed Caddy binary permission to bind :443 and :80
    - on macOS, managed Caddy uses wildcard listeners so it can open :443 without root
    - hostnames must still resolve to this machine; devhost manages Caddy, not DNS
    - the managed Caddy admin API listens at ${caddyAdminApiUrl}
    - routes are removed when the stack exits
`);
