---
title: "Install"
---

devhost is a single binary. Download it, put it on your `PATH`, and prepare Caddy once per machine.

## Download the binary

Every [release](https://github.com/alexgorbatchev/devhost/releases/latest) has an archive for each platform:

| Platform                     | Archive suffix     |
| ---------------------------- | ------------------ |
| macOS, Apple silicon         | `darwin-arm64`     |
| Linux, x86-64                | `linux-x64`        |
| Linux, ARM64                 | `linux-arm64`      |
| Linux, x86-64, musl (Alpine) | `linux-x64-musl`   |
| Linux, ARM64, musl (Alpine)  | `linux-arm64-musl` |

This installs the latest release. Set `platform` to your archive suffix:

```bash
platform=darwin-arm64
tag=$(curl -fsSLI -o /dev/null -w '%{url_effective}' https://github.com/alexgorbatchev/devhost/releases/latest | sed 's#.*/##')
curl -fsSL "https://github.com/alexgorbatchev/devhost/releases/download/$tag/devhost-$tag-$platform.tar.gz" | tar -xz
sudo install "devhost-$tag-$platform/devhost" /usr/local/bin/devhost
devhost --version
```

Any directory on your `PATH` works in place of `/usr/local/bin`.

## Prepare Caddy

devhost routes every hostname through one shared [Caddy](https://caddyserver.com/) server:

```bash
devhost caddy download          # skip if `caddy` is already on your PATH
devhost caddy privileged-ports  # Linux only: lets Caddy use port 443 without root
devhost caddy start
```

The first start installs Caddy's local certificate authority into your system trust store and can ask for your password. See [Route apps over HTTPS](../../guides/managed-caddy/#prepare-caddy) for details.

## Optional extras

- **Browser chat** needs an installed, signed-in [Codex CLI](https://learn.chatgpt.com/docs/cli) or [Claude Code](https://code.claude.com/docs/en/cli-reference). See [Chat with a coding agent](../../guides/annotations/).
- **Shell completion:** `source <(devhost completion zsh)`, or `bash`, `fish`, `powershell`. See the [CLI reference](../../reference/cli/#other-commands).
- **Coding agents:** `npx skills add alexgorbatchev/devhost --skill devhost -y` installs the devhost skill, which teaches agents every command and manifest rule. Set `AGENT=1` when an agent reads devhost's output; see [Terminal output](../../reference/output/).

## Next

[Run a stack](../../guides/stack-lifecycle/) from a `devhost.toml`, or [serve a folder or a port](../serve/) without one.
