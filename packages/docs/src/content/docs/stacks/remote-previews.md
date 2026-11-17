---
title: "Remote previews"
---

Run `devhost start --remote --detach` to give a stack public HTTPS URLs through an outbound relay. The development machine can sit behind NAT or move between networks. A viewer needs a browser and whatever login your gateway requires; neither a VPN nor a local devhost certificate is needed on the viewing device.

Remote previews require a configured gateway. devhost connects to an existing [Chisel](https://github.com/jpillora/chisel) relay; it does not provision a public service or DNS. A gateway reachable through an existing Cloudflare Tunnel works without a public IP on your development machine or home network.

## Configure a machine

Add `[remote]` to the machine's [`config.toml`](../../reference/cli/#files-and-directories). Keep it out of project manifests so the same checkout works on different machines.

```toml
[remote]
serverURL = "https://relay.example.com"
credentialFile = "relay.auth"
fingerprint = "REPLACE_WITH_THE_RELAY_SHA256_FINGERPRINT"
remotePort = 18081
domainSuffix = "--laptop--preview.example.com"
localSuffix = ".localhost"
```

The gateway administrator supplies the endpoint, full base64 SHA-256 Chisel fingerprint, assigned reverse port, public hostname suffix, and a separate credential for each machine. Store the supplied `username:password` in `relay.auth` beside `config.toml`, with permissions `0600`. An absolute credential path works too. Credentials stay out of the TOML editor, process arguments, and project files.

| Setting          | Meaning                                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `serverURL`      | HTTPS endpoint supporting WebSocket upgrades. HTTP is accepted only for loopback testing. Credentials, queries, and fragments are rejected. |
| `credentialFile` | Private file containing one `username:password` value. Relative paths resolve beside `config.toml`.                                         |
| `fingerprint`    | Complete base64 SHA-256 fingerprint of the relay's persistent Chisel key. The connector verifies it in addition to HTTPS.                   |
| `remotePort`     | Reverse listener allocated to this machine, from 1 through 65535.                                                                           |
| `domainSuffix`   | Public suffix assigned to this machine, including its leading dot or hyphen.                                                                |
| `localSuffix`    | Suffix to replace in manifest hostnames. Defaults to `.localhost`.                                                                          |

For this configuration, `web.localhost` becomes `web--laptop--preview.example.com`. The public hostname is selected before service commands and environment templates resolve, so `host` references and `DEVHOST_HOST` describe the hostname the browser uses. Direct service references such as `{{ services.api.url }}` continue to address the local service.

Use flat labels when the gateway certificate covers `*.example.com`: `web--laptop--preview.example.com` fits that wildcard; `web.app--laptop--preview.example.com` needs deeper certificate coverage. Hostnames must end in the configured local suffix or already use the public suffix. Every machine needs its own public suffix, reverse port, and credential.

## Start and stop previews

Start shared Caddy as usual, then opt a stack into remote access:

```bash
devhost caddy start
devhost start --remote --detach
```

Service selections work too: `devhost start --remote --detach web`. The command prints public HTTPS URLs only for routed services that started. Unrouted dependencies remain available to their local consumers.

Detached startup waits for service health, registered routes, and the relay connection. That confirms the connector is ready; verify the printed URL separately to check public DNS, gateway routing, certificates, and browser login. Repeating the command reports the existing remote stack and its URLs. Switching a running stack between local and remote mode requires stopping it first.

Use `devhost stop` and `devhost stack restart` normally. Manifest reloads, service selection, and worktree switches update the remote host allowlist along with the stack. Several remote stacks in one state directory share one connector; stopping one leaves the others reachable. Stopping the last removes the connector. Only hosts belonging to active remote stacks are forwarded.

If the connector process itself exits unexpectedly, restart a remote stack to launch a replacement. To replace the shared connector after upgrading devhost, stop all remote stacks before starting them with the new executable.

The connector retries after network interruptions. The public URL stays the same after reconnecting, while open requests and WebSockets may need to reconnect. A sleeping or offline development machine cannot serve its apps. Gateway WebSocket support is required for the tunnel, HMR, and live devtools connections.

Stop the remote stacks before changing `[remote]`, then start them again. Changes to these settings are rejected while a remote stack is running. Project manifest reloads and shared Caddy listener changes remain supported.

## Gateway requirements

The gateway terminates public HTTPS and sends preview requests, preserving the original hostname, to the machine's assigned reverse listener. The Chisel endpoint uses machine authentication; preview hostnames use browser authentication at the gateway. With Cloudflare Tunnel, both endpoints can be reached through outbound connections from the lab.

- Run a compatible Chisel server with reverse forwarding enabled and a persistent server key. devhost embeds Chisel 1.12.0.
- Restrict each machine credential to its exact reverse listener, for example the anchored auth-file rule `^R:0\.0\.0\.0:18081$`. The listener binds to all interfaces inside the relay's network namespace so the gateway proxy can reach it. Keep it on a private network rather than publishing the port on the host.
- Route that machine's public hostname suffix to its assigned listener. Point DNS at the public gateway and supply a certificate covering the resulting names.
- Support WebSocket upgrades on the connector endpoint and preview routes. Apply browser login to the preview routes; an interactive login page on the connector endpoint prevents connection.
- Treat preview access as access to development tools, including terminals and restart controls. The connector rejects changes to the machine configuration editor through remote routes; it is not an authentication service for the rest of the app.

The connector preserves the incoming hostname when proxying to local Caddy and verifies Caddy's certificate with its local root certificate. This lets the gateway's trusted certificate serve the browser while local TLS remains verified.

## Troubleshooting

If startup fails, read the printed stack log and the connector log under `<state>/remote/`. Check the credential file permissions, full fingerprint, assigned port, gateway reverse-forwarding permission, and WebSocket support. A browser login response on the connector endpoint is a routing error.

If the connector starts but the URL fails, check the gateway's hostname rule, DNS, certificate coverage, and browser authentication. If a local-only stack was already running, stop it and restart with `--remote`; repeating a detached start does not change its access mode.
