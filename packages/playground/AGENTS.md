# playground

Placeholder Bun + React workspace used to exercise `devhost` against a small routed app.

## Commands

- Start through devhost from this package: `bun run dev`
- Start the Bun server directly without devhost: `bun run server`
- Build the browser bundle: `bun run build`
- Start the production server: `bun run start`
- Start through devhost from the repo root: `apps/devhost/bin/devhost --manifest packages/playground/devhost.toml`
- Start managed Caddy for this manifest from the repo root: `apps/devhost/bin/devhost caddy start --manifest packages/playground/devhost.toml`

## Local conventions

- Keep this package on the repo-root `bun.lock`; do not add a package-local lockfile.
- `src/index.ts` owns the Bun server routes and serves `src/index.html` as the React app shell.
- `src/frontend.tsx` is the React browser entrypoint referenced by `src/index.html`.
- Keep `devhost.toml` pointed at `bun run server`; pointing it at `bun run dev` would recurse back into `devhost`.

## Local gotchas

- `devhost.toml` routes `https://playground.localhost` to the Bun server on port `3000`; avoid introducing another service on the same fixed port.
- The root `bun run dev` command delegates to this package's `dev` script, so it starts the `devhost` proxy for this playground.
- Shared `oxfmt` / `oxlint` enforcement runs from the repo root; do not add workspace-local lint or format config unless this package intentionally diverges.

## Boundaries

- Always: run `bun run --cwd packages/playground build` after changing app source or `package.json` scripts here.
- Always: run `bun run check:devhost` after changing `devhost.toml`.
- Ask first: changing the routed hostname, fixed port, or root `package.json` `dev` delegation.
- Never: commit `dist/`, `node_modules/`, or a package-local lockfile.

## References

- `package.json`
- `devhost.toml`
- `src/index.ts`
- `src/frontend.tsx`
