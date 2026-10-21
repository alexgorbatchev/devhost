# `devhost`

`devhost` gives your local app a proper front door: real hostnames, local HTTPS, and one command to start and route your dev services.

Use it when `localhost:3000` stops being good enough: auth callbacks, cookie/domain behavior, multi-service stacks, or just wanting `app.localhost` and `api.app.localhost` to behave more like a real app. Any domain can work as well, as long as it is configured to resolve to the machine running `devhost`.

Documentation: [alexgorbatchev.github.io/devhost](https://alexgorbatchev.github.io/devhost/)

The guides include short videos: start with [routing](https://alexgorbatchev.github.io/devhost/guides/managed-caddy/), [browser devtools](https://alexgorbatchev.github.io/devhost/guides/devtools/), or [annotations and live fixes](https://alexgorbatchev.github.io/devhost/guides/annotations/).

What it does well:

- routes local services onto HTTPS hostnames through managed Caddy
- starts one service or a full stack from `devhost.toml`, including optional externally managed backends
- serves startup status at service domains and forwards browser pages once health checks pass
- hot-reloads `devhost.toml` and included manifests, adding or removing services and applying configuration edits without restarting devhost
- edits those manifests and the shared `config.toml` from the browser with `[devtools.configEditor]` enabled, checking each save the way a reload does; see [Config editor](https://alexgorbatchev.github.io/devhost/guides/devtools/#config-editor)
- switches Git worktrees and refreshes added or deleted checkouts from the browser
- recovers services from the browser, with stable ports for individual restarts and **Restart Stack** for automatic-port conflicts
- optionally injects browser devtools for logs, service status, page context and native CLI chat, hotkey-driven restarts, and aggregated third-party launcher buttons

The injected devtools stay above page content without blocking clicks on the page around them. The toolbar can also gather the launchers of host-mounted TanStack, React Hook Form, Jotai, and Vue inspectors (`[devtools.externalToolbars]`), open the upstream Redux DevTools inspector for registered Redux Toolkit and Zustand stores, and open native React DevTools in a dedicated browser profile set by `[devtools.browser].endpoint`. See [Devtools](https://alexgorbatchev.github.io/devhost/guides/devtools/) and [External Devtools](https://alexgorbatchev.github.io/devhost/architecture/external-devtools/) for supported versions, setup, and limits.

## Quick start

### Installation

Download the archive for your platform from [GitHub Releases](https://github.com/alexgorbatchev/devhost/releases), extract it, and place the `devhost` binary on your `PATH`.

Published GitHub Releases include versioned `.tar.gz` archives for `darwin-arm64`, `linux-x64`, `linux-arm64`, `linux-x64-musl`, and `linux-arm64-musl`.

To print the CLI build version:

```bash
devhost --version
```

### Shell completion

`devhost completion <shell>` prints a completion script for `bash`, `zsh`, `fish`, or `powershell`. To load it in the current session:

```bash
source <(devhost completion bash)   # bash, with the bash-completion package installed
source <(devhost completion zsh)    # zsh, after compinit
devhost completion fish | source    # fish
```

To keep completion across sessions, write the script to the directory your shell loads completions from; `devhost completion <shell> --help` names that directory for each shell. Add `--no-descriptions` to complete command names without their descriptions.

### Output for agents and scripts

Set `AGENT=1` (`true` and `yes` work too) when an agent or a script reads the output. Help screens become compact text, and a command that fails reports the whole error with `devhost: ERR:`:

```console
$ devhost star
devhost | [ERROR] unknown command "star" for "devhost"; did you mean "stack" or "start" or "stop"?
devhost | [INFO] Run "devhost --help" for usage.
$ AGENT=1 devhost star
devhost: ERR: unknown command "star" for "devhost"; did you mean "stack" or "start" or "stop"?
```

See [Stack lifecycle](https://alexgorbatchev.github.io/devhost/guides/stack-lifecycle/) for the log and message formats of both modes.

### Requirements

- either:
  - a global `caddy` on your `PATH`, or
  - a managed Caddy binary downloaded with `devhost caddy download`
- an installed, signed-in Codex or Claude Code CLI for optional browser chat
- an explicitly configured dedicated Chrome **154.0.8037.92** or newer profile and original React Developer Tools **8.0.0** or newer for optional native React access; the inspected host must contain mounted React DOM **19.2.5**. Install the extension before loading that host. The browser stays user-owned; `devhost` attaches to its literal-loopback debugging endpoint.

### Minimal example

Configure your stack in `devhost.toml`, then start it with `devhost start`.

```toml
name = "hello-stack"

[devtools.shortcuts]
restartServices = "alt+ctrl+r"

[services.ui]
primary = true
command = ["bun", "run", "ui:dev"]
port = 3000
host = "foo.localhost"
dependsOn = ["api"]
watch = ["src/"]

[services.api]
command = ["bun", "run", "api:dev"]
port = 4000
host = "api.foo.localhost"
health = { http = "http://127.0.0.1:4000/healthz" }
```

Most projects should add `devhost start` to the relevant `package.json` so you can run it through the usual dev script from the directory that contains the manifest:

```json
{
  "scripts": {
    "dev": "devhost start"
  }
}
```

Then prepare Caddy once and start your stack:

```bash
devhost caddy download
devhost caddy start
npm run dev
open https://foo.localhost
```

The first `devhost caddy start` installs Caddy's local HTTPS certificate authority into the system trust store, which may ask for your password.

(`pnpm dev`, `yarn dev`, and `bun run dev` work the same way when they invoke the same script.)

To shut down a running stack cleanly, run the `stop` command from the manifest directory, or point to it explicitly:

```bash
devhost stop
# Or with an explicit manifest:
devhost stop --manifest path/to/devhost.toml
```

A service that exits does not stop the stack: its logs and a **Restart** control stay available in the browser. See [Stack lifecycle](https://alexgorbatchev.github.io/devhost/guides/stack-lifecycle/) for startup and recovery pages, restarts, and **Restart Stack**.

### Hostnames and Caddy

> [!IMPORTANT]
> `devhost` manages HTTPS routing through Caddy, not DNS.
> Your chosen hostnames must already resolve to this machine or the browser will never reach the local proxy.
>
> Good out-of-the-box choices are `localhost` and subdomains under `*.localhost`, such as `foo.localhost` and `api.foo.localhost`, because they work without additional DNS configuration.

On Linux, run `devhost caddy privileged-ports` once before the first HTTPS start if you want Caddy to bind privileged ports without running the whole stack as root.

The shared proxy's listeners, such as `httpsPort` and `bindHost`, are machine settings in the devhost config file `config.toml`, not manifest settings; saving it while stacks run moves the proxy without a restart. See [Shared managed Caddy settings](https://alexgorbatchev.github.io/devhost/guides/shared-managed-caddy-settings/).

### Configuration Hot Reload

While `devhost start` runs, saving `devhost.toml` or an included manifest applies the change without restarting devhost. Every setting reloads, and only the services an edit affects restart. An invalid edit leaves the stack running and prints `configuration reload rejected` with the reason. See [Configuration hot reload](https://alexgorbatchev.github.io/devhost/guides/stack-lifecycle/#configuration-hot-reload) for what each kind of edit restarts and how a failed reload is restored.

### Manifest features

- **Multiple domains:** set `host` to an array to route several domains to one service. See [Multiple hostnames for one service](https://alexgorbatchev.github.io/devhost/guides/managed-caddy/#multiple-hostnames-for-one-service).
- **Local-origin dev servers:** `proxyLocalOrigin = true` serves a development server, such as Bun's HTML/HMR server, that rejects the public hostname. See [Development servers that require a local origin](https://alexgorbatchev.github.io/devhost/guides/managed-caddy/#development-servers-that-require-a-local-origin).
- **Git worktrees:** the toolbar's **Worktrees** picker switches the stack to another checkout of its repositories; `[worktrees].enabled = false` turns it off. See [Devtools](https://alexgorbatchev.github.io/devhost/guides/devtools/) and [Configuration hot reload](https://alexgorbatchev.github.io/devhost/guides/stack-lifecycle/#configuration-hot-reload).
- **Zombie process recovery:** with `killZombies = true` (the default), devhost stops processes an earlier run of the same manifest left holding its hostnames or ports. See [Zombie cleanup messages](https://alexgorbatchev.github.io/devhost/guides/troubleshooting/#zombie-cleanup-messages).
- **Environment interpolation:** string values read environment variables through `{{ env.NAME }}` placeholders. See [Environment variables in the manifest](https://alexgorbatchev.github.io/devhost/guides/environment-variables/#environment-variables-in-the-manifest).
- **Service references:** `{{ services.<name>.<property> }}` placeholders pass values another service resolves at launch, such as an automatic port. See [Service References](https://alexgorbatchev.github.io/devhost/guides/service-references/).
- **Includes:** `includes = ["packages/*/devhost.toml"]` merges the services and groups of other manifests into one stack. See [Manifest Includes](https://alexgorbatchev.github.io/devhost/guides/manifest-includes/).
- **Service commands:** commands run directly, not through a shell. See [Service commands and working directories](https://alexgorbatchev.github.io/devhost/guides/stack-lifecycle/#service-commands-and-working-directories).

### Browser chat and page context

**Chat** in the toolbar talks to your installed Codex or Claude Code CLI, with its own sign-in and settings, in the selected checkout. **Select Elements**, or Alt-click, adds page elements and drawings as context, and a shared tab supplies a snapshot. A conversation keeps running while chat is collapsed or the page reloads, and devhost never approves a native request on its own. Set `[devtools.chat].enabled = false` or `[devtools.annotations].enabled = false` to turn either off. See the [chat and context guide](https://alexgorbatchev.github.io/devhost/guides/annotations/) for sharing, approvals, and selection plugins.

## Build from source

If you are working from this repository and want a current-platform binary instead of a release download:

```bash
just setup
just devhost compile
./apps/devhost/bin/devhost --version
```

That build refreshes the embedded injected devtools bundle and writes the CLI binary to `apps/devhost/bin/devhost` with the version from `apps/devhost/metadata.json` embedded into `devhost --version`.

Run `just cli <args>` to use the CLI from source. `just run` starts the repository's development stack; `just setup` installs the locked workspace dependencies, downloads the Go modules, and prepares the embedded devtools bundle for both commands.

## Frontend UI development

See [Devtools](https://alexgorbatchev.github.io/devhost/guides/devtools/) for how the injected assets are cached and the [Control API](https://alexgorbatchev.github.io/devhost/guides/devtools/#control-api) they use.

If you are modifying the injected browser devtools UI (`packages/devhost-ui/`) and want to test your changes instantly without manually rebuilding the Go app or restarting the service stack, you can use the built-in on-demand asset dev loop:

1. Set `DEVHOST_DEV_SOURCE_DIR` to the root of your devhost checkout. A relative path resolves against the manifest directory, so `DEVHOST_DEV_SOURCE_DIR=.` works for the repo-root `devhost.toml`; `just run` sets it for you.
2. On every browser page refresh, `devhost` checks whether any file under `packages/devhost-ui/src/devtools/` in that checkout is newer than `apps/devhost/internal/devtools/dist/devtools.js`.
3. If so, it runs `just --justfile <checkout>/apps/devhost/justfile build-devtools-bundle`, one build at a time, and serves the fresh development bundle without caching once the build finishes. Content-hashed chunks from earlier page loads remain available for active tabs.
4. If the build fails, or finishes without writing `devtools.js`, the page shows a `DEVHOST COMPILATION ERROR` banner with the details, and the next reload tries again.
5. If `DEVHOST_DEV_SOURCE_DIR` does not point at a devhost checkout, `devhost start` exits with an error naming the variable and the missing path.

## AI devhost skill

`devhost` provides an AI agent skill covering every command, flag, environment variable, and the rules for writing `devhost.toml`:

```bash
devhost skill
```

The command prints instructions to install the skill via the Skills CLI, together with the skill URL:

```console
$ devhost skill
Install the devhost skill using the Skills CLI:

  npx skills add alexgorbatchev/devhost --skill devhost

Skill:

  https://github.com/alexgorbatchev/devhost/tree/main/skills/devhost
```

Every `AGENT=1` help screen starts with a line that sends the agent to it:

```console
$ AGENT=1 devhost --help
ALERT: Agents must read `AGENT=1 devhost skill` before using this tool.
command: devhost
```

To install the skill directly into your coding agents:

```bash
npx skills add alexgorbatchev/devhost --skill devhost -y
```

Omit `-y` to choose target agents interactively.
