# Playground

This workspace contains two Bun + React apps for exercising `devhost` against routed local services starting on different ports:

- **Frontend**: A React app starting on port 3001, mounted at `/` (root path) on the routed host.
- **Backend**: A Bun API server starting on port 3000, mounted at `/api/*` on the exact same routed host.

Because they are routed on the same host using `devhost`'s managed Caddy routing, they share the same origin, avoiding CORS issues and allowing simple relative `/api/hello` requests from the frontend to the backend.

## Commands

Start the root devhost stack from the repository root:

```bash
just dev
```

The manifest routes `/api/*` to the backend on port `3000` and `/` to the frontend on port `3001`, and enables the injected devtools overlay.

## Project layout

- `backend/` — Backend app
  - `src/index.ts` — Bun API server with `/api/hello` routes.
- `frontend/` — Frontend React app
  - `src/index.ts` — Frontend static server.
  - `src/frontend.tsx` — React browser entrypoint.
  - `src/App.tsx` — placeholder React app.
- `devhost.toml` — local `devhost` manifest for the playground stack.

## Notes

- The root `just dev` command starts the repo-root `devhost.toml`, which includes this playground split services and Storybook.
