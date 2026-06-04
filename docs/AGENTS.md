# docs contributor notes

Local rules for the repository-level documentation in `docs/`.

## Shared commands

- Validate the documentation build: `bun run check`
- Format all files in the repository: `bun run fix`

## Documentation topology

- `docs/` — root directory for general documentation.
- `docs/internal/` — internal-only runbooks, onboarding, engineering designs, and maintained reference documentation; follow `docs/internal/AGENTS.md`.

## File Conventions

- **Naming:** All markdown filenames under `docs/` must use lowercase `kebab-case` naming (e.g. `on-demand-assets-dev-loop.md`).
- **File Extensions:** Use `.md` for all documentation files unless a template explicitly requires a different extension.

## Shared boundaries

- **Always:** Use clear heading hierarchies (`#`, `##`, `###`) to ensure that documentation remains scannable.
- **Never:** Hand-edit generated docs outputs (e.g., those generated under `packages/docs/src/content/docs/index.mdx` or `/reference/devhost-example.md`); edit their original sources in `apps/devhost/README.md` or `apps/devhost/devhost.example.toml` instead.
- **Ask first:** Before creating a new top-level directory or file category under `docs/` that doesn't fit the existing topology.
