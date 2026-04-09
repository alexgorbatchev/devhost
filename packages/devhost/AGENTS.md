# devhost package contributor notes

Local rules for the published `@alexgorbatchev/devhost` workspace in `packages/devhost/`.

## Documentation policy

- `README.md` must be kept up to date after behavior changes.
- `AGENTS.md` files must be kept up to date after workflow, policy, or contributor-expectation changes.
- Update `README.md` whenever you change:
  - CLI usage
  - manifest behavior
  - injected environment variables
  - routing behavior
  - logging behavior
  - devtools behavior
  - limitations, caveats, or failure modes
- If the manifest contract changes, also update `devhost.example.toml`.
- If devtools-specific contributor rules change, also update `src/devtools/AGENTS.md`.
- **CRITICAL:** The `devhost` README is heavily mirrored in the demo application's frontend. After editing the `devhost` README, you **must** update the `packages/www/src/app/App.tsx` file in the demo app workspace to keep the marketing website content in sync.
- Do not leave README or AGENTS examples/rules stale after changing implementation details.
- Repo-root `README.md` is a symlink to this workspace README; update `README.md` here, not the root symlink.

## Development workflow

Run the package directly:

```bash
bun run dev --help
```

Run the full test suite:

```bash
bun test
```

Run the package format step:

```bash
bun run fmt
```

Run the package check suite:

```bash
bun run check
```

The `fmt` script runs `oxfmt --write` for this workspace using the shared repo-root config. The package `check` script runs the native TypeScript typecheck and the coverage test suite for this workspace only. Run `bun run storybook` separately when Storybook coverage is in scope. Shared `oxfmt` / `oxlint` enforcement runs from the repo root.

## Internal package layout

- `bin/devhost.ts` — workspace CLI entrypoint
- `src/main.ts` — runtime entrypoint
- `src/index.ts` — public barrel re-exports
- `src/runDevhost.ts` — top-level orchestration and mode selection
- `src/agents/` — agent adapters and terminal commands
- `src/caddy/` — managed Caddy lifecycle, paths, and binding directives
- `src/devtools-server/` — injected browser UI injector and control servers
- `src/manifest/` — Zod v4 schema + semantic validation, and TOML loading
- `src/services/` — child process, dependency ordering, port resolution, and health check logic
- `src/utils/` — route utils, logging, and networking helpers
- `src/types/` — core stack types
- `src/devtools/` — injected browser UI code
  - `src/devtools/features/` — feature-owned UI modules such as `minimap/` and `serviceStatusPanel/`
  - `src/devtools/shared/` — cross-feature theme, config, transport, and shared types

## Logging rules

- All devhost-owned logs must go through the injected logger utility.
- Devhost-owned foreground lines must use the injected logger prefix.
- Manifest logs must use the manifest `name` as the prefix label.
- Pre-manifest logs must fall back to the `devhost` label.
- Child process logs must remain prefixed with `[service-name]`.
- Do not print successful Caddy reload chatter.
- Surface Caddy output only on failure.

## Devtools UI rules

For all injected UI work under `src/devtools/`, follow:

- `src/devtools/AGENTS.md`

Do not duplicate those rules here. Keep the devtools-specific styling and theming policy in the devtools-local AGENTS file.

## Shared tooling boundary

- Repo-root `package.json`, `oxfmt.config.ts`, and `oxlint.config.ts` own the shared TypeScript AI policy tooling.
- Do not reintroduce workspace-local copies of `@alexgorbatchev/typescript-ai-policy`, `oxfmt`, `oxlint`, or the shared lint/format configs here unless the workspace must intentionally diverge.
