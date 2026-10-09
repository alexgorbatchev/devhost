# playground

Bun + React workspace split into frontend and backend apps, used to exercise `devhost` routing and the overlay's supported TanStack Router and Query devtools, with the backend mounted under `/api/*` on the same host.

## Commands

- Start the root devhost stack from the repo root: `just dev`
- Run one app outside the stack from the repo root: `just playground-backend dev` or `just playground-frontend dev` (`start` runs it with `NODE_ENV=production`)
- Run the frontend query request tests from the repo root: `bun test packages/playground/frontend/src/__tests__`

## Local conventions

- Keep this package and its sub-workspaces on the repo-root `bun.lock`; do not add package-local lockfiles.
- `backend/src/index.ts` is the backend Bun server, serving `/api/hello` endpoints on port 3000 (or dynamic assigned port).
- `frontend/src/index.ts` is the frontend Bun server, serving `frontend/src/index.html` on port 3001 (or dynamic assigned port).
- The frontend server also serves the design prototypes from `packages/design` under `/prototypes/`: `references/*.html` and the `tokens.css` they link. `frontend/src/constants.ts` lists them for both the routes and the navigation links; add a new prototype there.
- The frontend server serves the demo videos page at `/videos` (`frontend/src/videos.html`) and its media under `/demo-videos/`. `frontend/src/readDemoMedia.ts` lists each `.tmp/demos/recording-*/devhost-demo.mp4` and the guide demos in `packages/docs/public/demos/` per request; only listed files are served, because a run directory also holds logs, sessions, and configuration. `frontend/src/constants.ts` names the page for both its route and its link in the second navigation row. The recorder films this app at a 1280-pixel width: keep that row on one line so the filmed layout does not move.
- `frontend/src/frontend.tsx` is the React browser entrypoint referenced by `frontend/src/index.html`.
- Keep Router and Query floating devtools mounted so the overlay can detect their native launchers. The playground uses their production-capable exports to exercise the overlay in either server mode.

## Local gotchas

- `devhost.toml` takes the shared hostname from `DEVHOST_PLAYGROUND`: `/api/*` goes to the backend, and `/` goes to the frontend. The frontend enables `proxyLocalOrigin` so Bun HTML assets and HMR accept the local upstream Host/Origin; keep the backend's default header handling.
- The root `just dev` command starts the repo-root `devhost.toml`, which includes this playground split services and Storybook.
- Playground `dev` recipes use Just's `[no-exit-message]` attribute so Ctrl-C does not print a wrapper recipe error per service. Child diagnostics and non-zero exit statuses still reach devhost, which owns stack shutdown progress and service exit reporting.
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
