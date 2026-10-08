# Playground

This workspace exercises `devhost` routing and the injected overlay, including the supported TanStack Router and TanStack Query devtools:

- **Frontend**: A React app mounted at `/` (root path) on the routed host.
- **Backend**: A Bun API server mounted at `/api/*` on the exact same routed host.

Because they are routed on the same host using `devhost`'s managed Caddy routing, they share the same origin, avoiding CORS issues and allowing simple relative `/api/hello` requests from the frontend to the backend.

## Commands

Start the root devhost stack from the repository root:

```bash
just dev
```

The root manifest assigns each service an available port, routes `/api/*` to the backend and `/` to the frontend, and enables the injected devtools overlay.

## Testing external devtools

Open the playground host configured by `DEVHOST_PLAYGROUND`. The overlay includes **Router** and **Query** toggles that open and close the native TanStack panels; the overlay hides their original floating launcher buttons.

- **API tester** (`/`): Send GET or PUT requests to the backend.
- **Query demo** (`/query`): Fetch `/api/hello` through TanStack Query. Click **Refetch query** to repeat the request and inspect `["playground", "hello"]` in Query devtools. Navigate back to the API tester to see the query become inactive.
- Open **Router** and switch between the pages to inspect the route matches and current location.

## Design prototypes

The second navigation row opens the design references from `packages/design/references/` on the playground host: the devtools prototype, the docs prototype, and the design system. Each is read from disk per request, so reload the page after editing one.

The devtools prototype draws its own mock toolbar, so on the playground host it appears together with the real injected overlay.

Both devtools remain mounted across route changes and are included in development and production playground runs.

## Project layout

- `backend/` — Backend app
  - `src/index.ts` — Bun API server with `/api/hello` routes.
- `frontend/` — Frontend React app
  - `src/index.ts` — Frontend static server.
  - `src/frontend.tsx` — React browser entrypoint.
  - `src/App.tsx` — Query provider and Router setup.
  - `src/components/` — playground layout and Query demo.
- `../../devhost.toml` — repository-root manifest for the playground stack.

## Notes

- The root `just dev` command starts the repo-root `devhost.toml`, which includes this playground split services and Storybook.
