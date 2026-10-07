# playground

Bun + React workspace split into frontend and backend apps, used to exercise `devhost` routing and the overlay's supported TanStack Router and Query devtools, with the backend mounted under `/api/*` on the same host.

## Commands

- Start the root devhost stack from the repo root: `just dev`
- Run the frontend query request tests from the repo root: `bun test packages/playground/frontend/src/__tests__`

## Local conventions

- Keep this package and its sub-workspaces on the repo-root `bun.lock`; do not add package-local lockfiles.
- `backend/src/index.ts` is the backend Bun server, serving `/api/hello` endpoints on port 3000 (or dynamic assigned port).
- `frontend/src/index.ts` is the frontend Bun server, serving `frontend/src/index.html` on port 3001 (or dynamic assigned port).
- `frontend/src/frontend.tsx` is the React browser entrypoint referenced by `frontend/src/index.html`.
- Keep Router and Query floating devtools mounted so the overlay can detect their native launchers. The playground uses their production-capable exports to exercise the overlay in either server mode.

## Local gotchas

- `devhost.toml` takes the shared hostname from `DEVHOST_PLAYGROUND`: `/api/*` goes to the backend, and `/` goes to the frontend. The frontend enables `proxyLocalOrigin` so Bun HTML assets and HMR accept the local upstream Host/Origin; keep the backend's default header handling.
- The root `just dev` command starts the repo-root `devhost.toml`, which includes this playground split services and Storybook.
- The root `oxfmt` and `oxlint` configs ignore `packages/playground/**`: this dev harness is intentionally excluded from shared lint and format enforcement (see the root `AGENTS.md`), so `just check` and `just fix` do not touch it. Do not add workspace-local lint or format config.

## Boundaries

- Always: run `just devhost check` after changing `devhost.toml`.
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
