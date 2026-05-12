---
created_on: 2026-05-12 09:53
last_modified: 2026-05-12 10:28
status: current
---

# Shadcn Migration Checklist

## Objective

Migrate `packages/devhost-ui` from Emotion-based styling to Tailwind v4 + shadcn while keeping the injected devtools UI isolated inside its existing Shadow DOM boundary.

## Guardrails

- [x] Keep the Shadow DOM isolation model; do not move devtools styling into host-page globals.
- [x] Treat this as an incremental platform migration, not a one-shot visual rewrite.
- [x] Keep runtime CSS delivery isolated to the devtools shadow root and keep Storybook stories styled through the shared stylesheet injector.
- [x] Do not remove Emotion until migrated surfaces have parity and passing validation.

## 1. Policy And Documentation

- [x] Update `packages/devhost-ui/src/devtools/AGENTS.md` to replace the Emotion-only styling rule with the new Tailwind/shadcn-in-shadow-root rule.
- [x] Update any other affected contributor docs that currently describe Emotion as the required styling path.
- [x] Document that Tailwind Preflight is allowed only inside the devtools shadow root.

## 2. Tailwind And Shadcn Infrastructure

- [x] Add Tailwind v4 dependencies and Vite integration in `packages/devhost-ui/package.json` and `packages/devhost-ui/vite.config.ts`.
- [x] Add a Tailwind entry stylesheet at `packages/devhost-ui/src/devtools/shared/devtools.css`.
- [x] Define `@import "tailwindcss"` and required `@source` directives in `packages/devhost-ui/src/devtools/shared/devtools.css`.
- [x] Add the alias wiring required for shadcn imports in `packages/devhost-ui/tsconfig.json`, `packages/devhost-ui/vite.config.ts`, and Storybook Vitest config.
- [x] Initialize shadcn in `packages/devhost-ui` with `components.json`.

## 3. Shadow-Root Stylesheet Delivery

- [x] Replace the Emotion-specific styling bootstrap in `packages/devhost-ui/src/devtools/shared/devtoolsCss.ts` with a shadow-root stylesheet injection path for compiled CSS.
- [x] Update `packages/devhost-ui/src/devtools/renderDevtools.ts` to attach the compiled stylesheet to the shadow root before rendering the app.
- [x] Update `packages/devhost-ui/.storybook/preview.ts` to import the shared devtools stylesheet into the Storybook iframe for legacy non-shadow stories.
- [x] Update `packages/devhost-ui/src/devtools/shared/stories/DevtoolsStoryShadowRoot.tsx` to inject the compiled stylesheet into each story shadow root.
- [x] Keep the xterm stylesheet scoped to the shadow root and verify story cleanup still removes injected xterm links.

## 4. Theme And Token Migration

- [x] Convert the current theme model in `packages/devhost-ui/src/devtools/shared/devtoolsTheme.ts` into semantic CSS-variable tokens.
- [x] Map the existing light and dark theme values onto shadcn-compatible tokens such as `background`, `foreground`, `card`, `popover`, `primary`, `secondary`, `muted`, `accent`, `destructive`, `border`, `input`, and `ring`.
- [x] Keep the existing theme context semantics where they still own runtime color-scheme selection.
- [x] Eliminate direct hardcoded visual values from feature code except for dynamic geometry, measured layout, and xterm integration values.

## 5. Shared Primitives First

- [x] Audit the current shared primitives under `packages/devhost-ui/src/devtools/shared/` before adding replacements.
- [x] Add the required shadcn primitives using the official CLI and component docs flow.
- [x] Start with the primitives used by the current migrated UI: `Button`, `Card`, `Badge`, and `Textarea`.
- [x] Add app-owned wrappers only where the devtools UI needs stable test IDs or app-specific behavior; do not create a parallel styling layer.

## 6. Incremental Feature Migration

- [x] Migrate low-risk shared surfaces and layout first, including `packages/devhost-ui/src/devtools/App.tsx`.
- [x] Migrate `packages/devhost-ui/src/devtools/features/serviceStatusPanel/ServiceStatusPanel.tsx` after the base primitives are stable.
- [x] Migrate `packages/devhost-ui/src/devtools/features/externalDevtoolsPanel/ExternalDevtoolsPanel.tsx` before tackling the denser annotation flows.
- [x] Migrate the annotation composer surfaces after button, textarea, and menu behavior are proven.
- [x] Migrate terminal-related surfaces last and verify Tailwind Preflight does not break xterm internals.

## 7. Emotion Removal

- [x] Remove Emotion usage from each migrated file only after the replacement stories and tests pass.
- [x] Remove `@emotion/css` from `packages/devhost-ui/package.json` after there are no runtime or Storybook callers left.
- [x] Delete `packages/devhost-ui/src/devtools/shared/devtoolsCss.ts` after the new CSS injection path is complete.

## 8. Validation

- [x] Run the narrowest relevant checks while migrating each slice.
- [x] Run `bun run --cwd packages/devhost-ui check` before calling the migration done.
- [x] Verify Storybook stories render correctly inside shadow roots for the new shadcn primitives and existing terminal/App shadow-root stories.
- [x] Verify light and dark themes both work after token conversion through `ThemeProvider` and Storybook coverage.
- [x] Verify xterm rendering, layout, and stylesheet cleanup after the terminal migration.

## Definition Of Done

- [x] `packages/devhost-ui` uses Tailwind v4 + shadcn for the injected UI surfaces.
- [x] Styles are delivered inside the Shadow DOM without leaking to the host page.
- [x] Storybook uses the shared stylesheet injector and shadow-root stories use the same shadow-root styling path as runtime.
- [x] Emotion is removed from the devtools UI implementation.
- [x] The affected docs and AGENTS guidance match the shipped architecture.
- [x] `bun run --cwd packages/devhost-ui check` passes.
- [x] `bun run check` passes.
