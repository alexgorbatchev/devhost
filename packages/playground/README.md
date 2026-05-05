# Playground

This package is a small Bun + React app for exercising `devhost` against a routed local service. The Bun server in `src/index.ts` serves the React app shell and exposes simple `/api/hello` endpoints used by the placeholder UI.

## Commands

Run commands from `packages/playground/` unless a command says otherwise.

```bash
bun run dev
```

Starts the playground through `devhost` using `devhost.toml`.

```bash
bun run server
```

Starts the Bun development server directly. Hot reloading stays enabled through the `Bun.serve()` development mode in `src/index.ts`, which avoids leaving behind the detached process that `bun --hot` created under `devhost` management. `devhost.toml` uses this script for the managed `web` service so `bun run dev` does not recurse into `devhost`.

```bash
bun run build
```

Builds the browser bundle into `dist/`.

```bash
bun run start
```

Starts the Bun server with `NODE_ENV=production`.

## Run through `devhost`

Start the shared managed Caddy instance once from the repository root:

```bash
apps/devhost/bin/devhost caddy start --manifest packages/playground/devhost.toml
```

Then start this playground stack:

```bash
bun run --cwd packages/playground dev
```

Open the routed app at:

```text
https://playground.localhost
```

The manifest routes the `web` service to `bun run server` on port `3000` and enables the injected devtools overlay. Annotation actions include a Pi agent action and a command action that runs the package build.

## Project layout

- `src/index.ts` — Bun server routes and static app shell serving.
- `src/frontend.tsx` — React browser entrypoint.
- `src/App.tsx` — placeholder React app.
- `devhost.toml` — local `devhost` manifest for the playground stack.

## Notes

- The root `bun run dev` command delegates to `packages/playground` and starts this `devhost` stack.
- Use `bun run server` only when you want the Bun app without the HTTPS hostname, routing, or injected devtools overlay.
