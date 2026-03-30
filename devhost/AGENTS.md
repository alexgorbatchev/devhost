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
- If the manifest contract changes, also update `../docs/toml-config.md`.
- If devtools-specific contributor rules change, also update `src/devtools/AGENTS.md`.
- Do not leave README or AGENTS examples/rules stale after changing implementation details.

## Development workflow

Run the package directly:

```bash
cd devhost && bun run dev --help
```

Run the full test suite:

```bash
cd devhost && bun test src/__tests__
```

Run coverage:

```bash
cd devhost && bun run test:coverage
```

## Internal package layout

- `bin/devhost.ts` — workspace CLI entrypoint
- `src/index.ts` — runtime entrypoint
- `src/runDevhost.ts` — top-level orchestration and mode selection
- `src/startSingleService.ts` — single-service flow
- `src/startStack.ts` — manifest-mode flow
- `src/validateManifest.ts` — Zod v4 schema + semantic validation
- `src/routeUtils.ts` — route file management and Caddy reload logic
- `src/devtools/` — injected browser UI code

## Logging rules

- All devhost-owned logs must go through the injected logger utility.
- Devhost-owned foreground lines must use the injected logger prefix.
- Manifest-mode logs must use the manifest `name` as the prefix label.
- Single-service and pre-manifest logs must fall back to the `devhost` label.
- Child process logs must remain prefixed with `[service-name]`.
- Do not print successful Caddy reload chatter.
- Surface Caddy output only on failure.

## Devtools UI rules

For all injected UI work under `src/devtools/`, follow:

- `src/devtools/AGENTS.md`

Do not duplicate those rules here. Keep the devtools-specific styling and theming policy in the devtools-local AGENTS file.
