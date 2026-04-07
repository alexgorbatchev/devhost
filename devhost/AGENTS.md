# devhost contributor notes

This file contains internal development rules for `devhost/`.

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
- Do not leave README or AGENTS examples/rules stale after changing implementation details.

## Development workflow

Run the package directly:

```bash
cd devhost && bun run dev --help
```

Run the full test suite:

```bash
cd devhost && bun test
```

Run the package check suite:

```bash
cd devhost && bun run check
```

The check script runs the native TypeScript typecheck, the coverage test suite, and the Storybook component test suite.

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
- Manifest-mode logs must use the manifest `name` as the prefix label.
- Pre-manifest logs must fall back to the `devhost` label.
- Child process logs must remain prefixed with `[service-name]`.
- Do not print successful Caddy reload chatter.
- Surface Caddy output only on failure.

## Devtools UI rules

For all injected UI work under `src/devtools/`, follow:

- `src/devtools/AGENTS.md`

Do not duplicate those rules here. Keep the devtools-specific styling and theming policy in the devtools-local AGENTS file.
