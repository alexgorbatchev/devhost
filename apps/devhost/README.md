# `devhost`

**Your dev stack, on real HTTPS hostnames, with one command.** `devhost` starts every service your app needs, puts each one on a hostname like `https://app.localhost`, and keeps the whole thing running while you break things.

Stop juggling `localhost:3000`, `localhost:4000`, and a terminal tab per service. Auth callbacks, cookies, CORS, and service-to-service URLs behave the way they do in production.

[Documentation](https://alexgorbatchev.github.io/devhost/) · [Install](https://alexgorbatchev.github.io/devhost/start/install/) · [How it works](https://alexgorbatchev.github.io/devhost/start/how-it-works/)

## Why devhost

- **Real hostnames, real HTTPS.** Give each service its own trusted `https://` hostname, with path routes and aliases, through one shared proxy. No DNS setup for `.localhost` names.
- **One command for the whole stack.** `devhost start` launches services in dependency order and waits until each is healthy. Name one app and it starts just that app and what it needs.
- **Crashes don't take you down.** A failing service shows its error and logs right at its URL, with a **Restart** button. Everything else keeps running.
- **Edit config live.** Save `devhost.toml` and only the affected services restart. A typo never kills the stack.
- **Devtools in your page.** An optional toolbar with service status, live logs, restarts, Git worktree switching, and your React, Redux, TanStack, Vue, and Jotai devtools in one place.
- **Point, and let an agent fix it.** Chat with your own Codex or Claude Code from the page: click elements, draw on it, attach a screenshot, and send.

## A quick look

```toml
# devhost.toml
name = "shop"

[services.web]
command = ["bun", "run", "dev"]
port = 3000
host = "shop.localhost"
dependsOn = ["api"]

[services.api]
command = ["bun", "run", "api"]
port = 4000
host = "api.shop.localhost"
health = { http = "/healthz" }
```

```text
$ devhost start
shop    | web (primary): https://shop.localhost
shop    | api: https://api.shop.localhost
```

That's the stack: the API starts first, the web app once the API is healthy, both on HTTPS.

## Install

On macOS with Apple silicon:

```bash
tag=$(curl -fsSLI -o /dev/null -w '%{url_effective}' https://github.com/alexgorbatchev/devhost/releases/latest | sed 's#.*/##')
curl -fsSL "https://github.com/alexgorbatchev/devhost/releases/download/$tag/devhost-$tag-darwin-arm64.tar.gz" | tar -xz
sudo install "devhost-$tag-darwin-arm64/devhost" /usr/local/bin/devhost
devhost caddy download && devhost caddy start
```

Linux builds and the full setup are in the [install guide](https://alexgorbatchev.github.io/devhost/start/install/).

## Learn more

The [documentation](https://alexgorbatchev.github.io/devhost/) covers every feature, with short videos: [routing](https://alexgorbatchev.github.io/devhost/guides/managed-caddy/), [running a stack](https://alexgorbatchev.github.io/devhost/guides/stack-lifecycle/), [the toolbar](https://alexgorbatchev.github.io/devhost/guides/devtools/), and [chatting with a coding agent](https://alexgorbatchev.github.io/devhost/guides/annotations/).

Using a coding agent? `npx skills add alexgorbatchev/devhost --skill devhost` teaches it devhost.

## License

[MIT](https://github.com/alexgorbatchev/devhost/blob/main/LICENSE)
