# playground

Placeholder Bun + React workspace split into frontend and backend apps, used to exercise `devhost` against routed local services starting on different ports.

## Commands

- Start the full playground stack through devhost from this package root: `bun run dev`
- Build the frontend browser bundle: `bun run build` (runs `bun run --cwd frontend build`)
- Start the root devhost stack from the repo root: `bun run dev`
- Start managed Caddy for this manifest from the repo root: `apps/devhost/bin/devhost caddy start --manifest packages/playground/devhost.toml`

## Local conventions

- Keep this package and its sub-workspaces on the repo-root `bun.lock`; do not add package-local lockfiles.
- `backend/src/index.ts` is the backend Bun server, serving `/api/hello` endpoints on port 3000 (or dynamic assigned port) with CORS headers.
- `frontend/src/index.ts` is the frontend Bun server, serving `frontend/src/index.html` on port 3001 (or dynamic assigned port).
- `frontend/src/frontend.tsx` is the React browser entrypoint referenced by `frontend/src/index.html`.
- Use the `BUN_PUBLIC_API_URL` environment variable in the frontend to point to the backend server.

## Local gotchas

- `devhost.toml` routes `https://devhost-devbox.cvb.lol` (or `https://playground.localhost` at root) to the frontend, and `https://api-devbox.cvb.lol` (or `https://api.playground.localhost` at root) to the backend API.
- The root `bun run dev` command starts the repo-root `devhost.toml`, which includes this playground split services and Storybook.
- Shared `oxfmt` / `oxlint` enforcement runs from the repo root; do not add workspace-local lint or format config unless these packages intentionally diverge.

## Boundaries

- Always: run `bun run --cwd packages/playground build` after changing frontend app source or `package.json` scripts.
- Always: run `bun run check:devhost` after changing `devhost.toml`.
- Ask first: changing the routed hostname, fixed port, or root `package.json` `dev` delegation.
- Never: commit any `dist/`, `node_modules/`, or a package-local lockfile.

## References

- `package.json`
- `devhost.toml`
- `backend/package.json`
- `backend/src/index.ts`
- `frontend/package.json`
- `frontend/src/index.ts`
- `frontend/src/frontend.tsx`
