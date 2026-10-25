# docs contributor notes

Local rules for the repository-level documentation in `docs/`.

## Shared commands

- Validate the documentation build: `just check`
- Format all files in the repository: `just fix`
- Regenerate architecture diagrams: `ARCHIFY_CLI=/path/to/archify/bin/archify.mjs just archify build`; see `internal/architecture/index.md` for prerequisites.

## Documentation topology

- `docs/` — root directory for general documentation.
- `docs/internal/` — internal-only runbooks, onboarding, engineering designs, and maintained reference documentation; follow `docs/internal/AGENTS.md`.

## File Conventions

- **Naming:** All markdown filenames under `docs/` must use lowercase `kebab-case` naming (e.g. `on-demand-assets-dev-loop.md`).
- **File Extensions:** Use `.md` for documentation prose. Archify specifications and generated standalone diagrams in `internal/architecture/` use `.json` and `.html`; its `justfile` owns regeneration.

## Shared boundaries

- **Always:** Use clear heading hierarchies (`#`, `##`, `###`) to ensure that documentation remains scannable.
- **Never:** Hand-edit generated docs outputs (e.g., those generated under `packages/docs/src/content/docs/index.mdx` or `/reference/devhost-example.md`); edit their original sources in `apps/devhost/README.md` or `apps/devhost/devhost.example.toml` instead.
- **Ask first:** Before creating a new top-level directory or file category under `docs/` that doesn't fit the existing topology.
