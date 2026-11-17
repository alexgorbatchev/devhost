# Remote previews

Use this workflow when a user needs to review a development app from a phone, away from the development machine, or on another network. Prefer the enrolled machine where the agent is working, whether laptop or devbox. The viewer needs only a browser and gateway login; the serving machine must remain awake and online.

## Choose and enroll the machine

Inspect existing machine configuration and the repository's established host convention before choosing where to run. Reuse an existing gateway. For initial setup, follow the public [relay, laptop, and devbox walkthrough](https://alexgorbatchev.github.io/devhost/stacks/remote-previews/): it configures the shared relay, separate credentials and ports for both machines, protected public routes, and both client configurations. Example ports and domains are placeholders, not existing allocations.

Obtain enrollment settings from the gateway's configuration or operator. Give each machine its own credential, assigned reverse port, and public suffix; the relay endpoint and fingerprint are shared. Use only this machine's enrolled credential and operator-allocated port. If enrollment is unavailable, identify the missing settings and use an already enrolled host when authorized and suitable; continue independent application work. A local-only URL does not satisfy a remote preview request.

## Machine configuration

Read the machine's `config.toml`, selected through `DEVHOST_CONFIG_DIR`, `XDG_CONFIG_HOME`, or `~/.config/devhost/`. `[remote]` contains:

- `serverURL`: HTTPS Chisel endpoint supporting WebSockets. HTTP is restricted to loopback testing.
- `credentialFile`: a private `0600` file containing the supplied `username:password`; relative paths resolve beside the config file. Keep credentials in this file and handle it as a secret.
- `fingerprint`: the complete base64 SHA-256 fingerprint of the relay's persistent key.
- `remotePort`: this machine's assigned reverse listener, from 1 through 65535.
- `domainSuffix`: this machine's public suffix, including its leading dot or hyphen.

The top-level `domainSuffix` selects the suffix for local runs and defaults to `.localhost`. Keep machine settings in the environment's established configuration source, such as its dotfiles profile, and use `DEVHOST_CONFIG_DIR` or the existing config-management links to select it. Preserve existing `[caddy]` settings. Stop affected local stacks before changing top-level `domainSuffix`, then start them again; active local stacks reject suffix changes. Stop all active remote stacks before changing `[remote]`, then start them again; active remote stacks reject those changes. Project manifest reloads and shared Caddy listener changes remain available while stacks run.

Use a single DNS label in each routed `host`, such as `"web"` or `["web", "admin"]`. With `remote.domainSuffix = "--laptop--preview.example.com"`, `web` resolves to `web--laptop--preview.example.com`; with `--local` and the default top-level suffix, it resolves to `web.localhost`. These flat public labels fit a single-level wildcard certificate. Remote mode rejects dotted hosts, including already-public hosts. To migrate an earlier manifest, replace its full hostnames with their app labels and remove `remote.localSuffix` from machine configuration. Public hosts are resolved before service commands and environment templates; direct service `url` references continue to use their local listeners. Fully qualified hostnames remain available for local routing.

## Run and verify

1. Discover the repository's services, existing manifest, short host labels, and health checks using the usual devhost workflow. Use the machine configuration for local and public suffixes. Preserve other environment settings the app requires; devhost reads exported variables and leaves repository dotenv loading to the wrapper or shell.
2. Ensure shared Caddy is running, then run `AGENT=1 devhost start --detach [service-or-group...]` with the repository's required environment. A configured `[remote]` selects remote mode automatically; `--remote` / `-r` explicitly requires enrollment and `--local` / `-l` selects local routing. These flags are mutually exclusive. Use the existing repository wrapper when it forwards arguments. A wrapper that already accepts flags needs no change; use an existing argument-forwarding entrypoint when a narrower recipe accepts none. Invalid settings and relay connection failures report errors; remote startup has no local fallback.
3. Read the printed HTTPS URLs and log path. Readiness covers services, routes, and a connected relay. Verify the requested page through the public gateway, including browser authentication and expected content; check WebSockets when the preview depends on them. Return the verified URL from output, including its route path, rather than constructing one or sharing a loopback/local-only URL. If authentication prevents verification, report that precise gap instead of claiming the preview is verified.
4. To recover the URLs, repeat detached startup with the same manifest, environment, selection, and remote mode; it reports the running stack and URLs. `devhost stack list` reports processes and manifests, not preview URLs. Stop a local stack before starting it in remote mode, and vice versa. Use `devhost stop` and `devhost stack restart` normally.

One connector per state directory serves all active remote stacks and forwards only their active hosts. Service selection, reloads, and worktree switches update the allowlist. Stopping the final remote stack removes the connector. Restart a remote stack to recover an unexpectedly exited connector. After upgrading devhost, stop all remote stacks before restarting them to replace the shared worker. Network changes trigger reconnects with stable URLs; open requests and WebSockets can require a reconnect, and the machine must stay awake to serve requests.

## Gateway and access boundary

Use a compatible Chisel server with a persistent key and reverse forwarding enabled. devhost embeds Chisel 1.12.0. The machine credential is restricted to its exact reverse listener, such as `^R:0\.0\.0\.0:18081$`. The gateway reaches that listener on its private network, routes the machine's hostname suffix to it, and preserves Host and WebSocket upgrades.

Keep the connector endpoint on machine authentication and preview routes on browser authentication. Preview access includes development tools such as terminals and restart controls. Remote requests to edit machine configuration are rejected. The connector verifies local Caddy TLS with its root certificate; the viewing browser sees the gateway's public certificate.

Read the public [remote preview reference](https://alexgorbatchev.github.io/devhost/stacks/remote-previews/) for setup details and troubleshooting.
